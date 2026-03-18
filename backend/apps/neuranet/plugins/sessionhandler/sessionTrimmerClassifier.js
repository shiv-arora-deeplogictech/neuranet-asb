/**
 * sessionTrimmerClassifier.js — Heuristic classifier to decide if a chat session can be trimmed.
 * Returns true (safe to trim, standalone query) or false (follow-up, keep session).
 *
 * Three-phase pipeline:
 *   Phase 1 — Hard rules: explicit prior-context references, continuation verbs, deictic+edit combos.
 *             Any match => false immediately.
 *   Phase 2 — Soft scoring: accumulate follow-up evidence (positive) vs standalone evidence (negative).
 *   Phase 3 — Decision: score >= threshold => false (follow-up); score < lowerBound => true (standalone);
 *             borderline band [threshold - borderline_margin, threshold) => false (conservative).
 *
 * All tunable values (thresholds, scoring weights, cue words) live in sessionhandler.json.
 * (C) 2023 TekMonks. All rights reserved.
 */

const conf = require(`${NEURANET_CONSTANTS.PLUGINSDIR}/sessionhandler/sessionhandler.json`);

// Reads isLatin flag from lang_cues in conf; defaults true (English baseline) for unlisted languages.
function _isLatinScript(language) {
	const langConf = (conf.classifier.lang_cues || {})[language || "en"];
	return langConf ? (langConf.isLatin ?? true) : true;
}

// Counts all non-overlapping matches of a global regex in text.
function _countMatches(regexGlobal, text) {
	regexGlobal.lastIndex = 0;
	let count = 0;
	while (regexGlobal.exec(text)) count++;
	return count;
}

// Factory — returns a classify(question, session, language) function.
function createTrimClassifier(userOptions = {}) {
	const classifierConf = conf.classifier;
	const options = {
		threshold:        classifierConf.threshold,
		borderlineMargin: classifierConf.borderline_margin,
		debug:            false,
		...userOptions
	};

	const scoring        = classifierConf.scoring;
	const tokenThresh    = classifierConf.token_thresholds;
	const inlineConf     = classifierConf.inline_context;
	const commonAcronyms = classifierConf.common_acronyms;

	// Main classifier — true = safe to trim, false = keep session.
	function classify(newQuestion, previousConversation = "", language = "en") {
		const qRaw      = String(newQuestion         || "").trim();
		const sRaw      = String(previousConversation || "").trim();
		const hasSession = sRaw.length > 0;
		const reasons   = [];

		if (!qRaw) return _respond(true, ["empty-question => standalone"], options);

		const re      = _compileRegexes(_buildCues(language));
		const isLatin = _isLatinScript(language);

		// Strip code blocks and quotes to avoid false positives from pasted content.
		const q = _stripCodeAndQuotes(qRaw).toLowerCase();

		// If the user pasted substantial context inline, references are self-contained.
		const hasInlineContext = _providesContextInline(qRaw, inlineConf, re.inlineContextColon);
		if (hasInlineContext) reasons.push("inline-context-present");

		// --- Phase 1: Hard rules — immediate false on any match ---

		if (re.strongPrevRef.test(q)) {
			reasons.push("hard-rule: strong previous reference");
			return _respond(false, reasons, options);
		}

		if (re.summarizeRewriteVerifyPrev.test(q)) {
			reasons.push("hard-rule: summarize/rewrite/verify previous");
			return _respond(false, reasons, options);
		}

		// "fix/explain THIS code" without inline context = session reference.
		if (!hasInlineContext && re.editVerb.test(q) && re.objectRef.test(q) && re.deictic.test(q)) {
			reasons.push("hard-rule: edit verb + object + deictic without inline context");
			return _respond(false, reasons, options);
		}

		// "continue / proceed / go on" without inline context = explicit continuation.
		if (!hasInlineContext && re.continueVerb.test(q)) {
			reasons.push("hard-rule: continuation verb without inline context");
			return _respond(false, reasons, options);
		}

		// --- Phase 2: Soft scoring — positive = follow-up evidence, negative = standalone evidence ---

		let score = 0;

		if (re.continuationStart.test(q)) {
			score += scoring.continuation_start;
			reasons.push(`score +${scoring.continuation_start}: starts with continuation word`);
		}

		const deicticCount = _countMatches(re.deicticGlobal, q);
		if (deicticCount > 0) {
			const deicticScore = Math.min(scoring.deictic_cap, scoring.deictic_per_word * deicticCount);
			score += deicticScore;
			reasons.push(`score +${deicticScore.toFixed(1)}: deictic words (count: ${deicticCount})`);
		}

		const pronounCount = _countMatches(re.pronounGlobal, q);
		if (pronounCount > 0) {
			const pronounScore = Math.min(scoring.pronoun_cap, scoring.pronoun_per_word * pronounCount);
			score += pronounScore;
			reasons.push(`score +${pronounScore.toFixed(1)}: ambiguous pronouns (count: ${pronounCount})`);
		}

		if (re.repetitionCue.test(q)) {
			score += scoring.repetition_cue;
			reasons.push(`score +${scoring.repetition_cue}: repetition cue`);
		}

		if (re.editVerb.test(q) && re.objectRef.test(q)) {
			score += scoring.edit_verb_with_object;
			reasons.push(`score +${scoring.edit_verb_with_object}: edit verb + object reference`);
		}

		// Shorter questions are more likely follow-ups; longer ones suggest a new topic.
		const tokenCount = _tokenize(q, language).length;
		if      (tokenCount <= tokenThresh.very_short) { score += scoring.very_short_question; reasons.push(`score +${scoring.very_short_question}: very short (${tokenCount} tokens)`); }
		else if (tokenCount <= tokenThresh.short)       { score += scoring.short_question;      reasons.push(`score +${scoring.short_question}: short (${tokenCount} tokens)`); }
		else if (tokenCount >= tokenThresh.long)        { score += scoring.long_question;       reasons.push(`score ${scoring.long_question}: long (${tokenCount} tokens)`); }

		// More named entities = more likely a fresh, self-contained topic. Skipped for non-Latin scripts.
		const namedEntityCount = _roughNamedEntityCount(qRaw, commonAcronyms, isLatin);
		if (namedEntityCount >= tokenThresh.min_named_entities) {
			score += scoring.named_entities;
			reasons.push(`score ${scoring.named_entities}: named entities (count: ${namedEntityCount})`);
		}

		if (!hasSession) {
			score += scoring.no_session;
			reasons.push(`score ${scoring.no_session}: no session present`);
		}

		if (hasInlineContext) {
			score += scoring.inline_context;
			reasons.push(`score ${scoring.inline_context}: inline context provided`);
		}

		// Session exists + deictic/pronoun = conservative bump to avoid premature trim.
		if (hasSession && !hasInlineContext && (deicticCount > 0 || pronounCount > 0)) {
			score += scoring.anaphoric_with_session;
			reasons.push(`score +${scoring.anaphoric_with_session}: session exists + anaphoric reference`);
		}

		// --- Phase 3: Decision — threshold with conservative borderline band ---

		const { threshold, borderlineMargin } = options;
		const lowerBound = threshold - borderlineMargin;

		if (score >= threshold) {
			reasons.push(`decision: follow-up (score ${score.toFixed(2)} >= ${threshold})`);
			return _respond(false, reasons, options);
		}
		if (score >= lowerBound) {
			reasons.push(`decision: borderline follow-up (score ${score.toFixed(2)} in [${lowerBound.toFixed(2)}, ${threshold}))`);
			return _respond(false, reasons, options);
		}

		reasons.push(`decision: standalone (score ${score.toFixed(2)} < ${lowerBound.toFixed(2)})`);
		return _respond(true, reasons, options);
	}

	return classify;
}

// Merges English baseline cues with language-specific cues from lang_cues in conf.
function _buildCues(language = "en") {
	const baseCues = conf.classifier.cues;
	const merged = {
		strongPrevRef:              [...baseCues.strongPrevRef],
		summarizeRewriteVerifyPrev: [...baseCues.summarizeRewriteVerifyPrev],
		continuationStarters:       [...baseCues.continuationStarters],
		deictics:                   [...baseCues.deictics],
		repetitionCues:             [...baseCues.repetitionCues],
		editVerbs:                  [...baseCues.editVerbs],
		continueVerbs:              [...baseCues.continueVerbs],
		objectRefs:                 [...baseCues.objectRefs],
		pronouns:                   [...baseCues.pronouns],
		inlineContextPhrases:       [...(baseCues.inlineContextPhrases || [])]
	};

	// Union language-specific cues on top (English is already the baseline, skip it).
	const langCues = (conf.classifier.lang_cues || {})[language];
	if (langCues && language !== "en") {
		for (const key of Object.keys(langCues)) {
			if (!Array.isArray(langCues[key])) continue;
			merged[key] = Array.from(new Set([...(merged[key] || []), ...langCues[key]]));
		}
	}

	return merged;
}

// Compiles all cue lists into named RegExp objects. Called once per language.
function _compileRegexes(cues) {
	// ASCII continuation starters get \b; non-ASCII (CJK, Thai) do not.
	const starterParts = cues.continuationStarters.map(s => {
		const escaped = _escapeRegex(s);
		return /^[\x00-\x7F]+$/.test(s) ? `${escaped}\\b` : escaped;
	}).join("|");

	// Build inline-context colon regex from configured phrases (matches "phrase:" or "phrase：").
	const inlineParts = (cues.inlineContextPhrases || []).map(p => {
		const escaped = _escapeRegex(p);
		return /^[\x00-\x7F]+$/.test(p) ? `\\b${escaped}\\b` : escaped;
	}).join("|");
	const inlineContextColon = inlineParts.length
		? new RegExp(`(?:${inlineParts})\\s*[:：]`, "iu")
		: /$a/; // never-matching fallback

	return {
		strongPrevRef:              _phraseUnionRegex(cues.strongPrevRef,              "i"),
		summarizeRewriteVerifyPrev: _phraseUnionRegex(cues.summarizeRewriteVerifyPrev, "i"),
		continuationStart:          new RegExp(`^\\s*(?:${starterParts})`, "iu"),
		deictic:                    _phraseUnionRegex(cues.deictics,       "i"),
		deicticGlobal:              _phraseUnionRegex(cues.deictics,       "ig"),
		repetitionCue:              _phraseUnionRegex(cues.repetitionCues, "i"),
		editVerb:                   _phraseUnionRegex(cues.editVerbs,      "i"),
		continueVerb:               _phraseUnionRegex(cues.continueVerbs,  "i"),
		objectRef:                  _phraseUnionRegex(cues.objectRefs,     "i"),
		pronounGlobal:              _phraseUnionRegex(cues.pronouns,       "ig"),
		inlineContextColon
	};
}

// Builds a single regex matching any phrase in the list. ASCII words get \b; non-ASCII don't.
function _phraseUnionRegex(phrases, flags) {
	const parts = (phrases || []).map(p => {
		const s = String(p).trim();
		if (!s) return null;
		if (/\s/.test(s)) return s.split(/\s+/).map(_escapeRegex).join("\\s+"); // multi-word phrase
		return /^[\x00-\x7F]+$/.test(s) ? `\\b${_escapeRegex(s)}\\b` : _escapeRegex(s);
	}).filter(Boolean);

	if (!parts.length) return /$a/; // never-matching fallback for empty list
	const finalFlags = flags.includes("u") ? flags : flags + "u";
	return new RegExp(`(?:${parts.join("|")})`, finalFlags);
}

function _escapeRegex(s) {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Strips fenced code blocks, inline code, and blockquotes to avoid false positives on pasted content.
function _stripCodeAndQuotes(s) {
	return String(s)
		.replace(/```[\s\S]*?```/g, " ")
		.replace(/`[^`]*`/g, " ")
		.replace(/(^|\n)\s*>.*(\n\s*>.*)*/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

// Returns true if the question contains substantial inline context (code block, many lines, long quote).
function _providesContextInline(raw, inlineConf, inlineContextColonRegex) {
	const s = String(raw);

	if (/```[\s\S]*?```/.test(s)) return true;

	if (s.split(/\r?\n/).filter(l => l.trim().length > 0).length >= inlineConf.min_lines) return true;

	// Use language-aware phrases compiled from config (matches both ":" and full-width "：").
	const colonMatch = s.search(inlineContextColonRegex);
	if (colonMatch >= 0) {
		const colonCharIdx = s.indexOf(":", colonMatch);
		const fullWidthColonIdx = s.indexOf("：", colonMatch);
		const effectiveIdx = colonCharIdx >= 0 && fullWidthColonIdx >= 0
			? Math.min(colonCharIdx, fullWidthColonIdx)
			: (colonCharIdx >= 0 ? colonCharIdx : fullWidthColonIdx);
		if (effectiveIdx >= 0 && s.slice(effectiveIdx + 1).trim().length >= inlineConf.min_chars_after_colon) return true;
	}

	const minQ = inlineConf.min_chars_in_quotes;
	if (new RegExp(`"[^"]{${minQ},}"`).test(s) || new RegExp(`'[^']{${minQ},}'`).test(s)) return true;

	return false;
}

// Tokenizes text using Intl.Segmenter for accurate word counts across all languages (same approach as ailibGPT35.js).
function _tokenize(s, language = "en") {
	const str = String(s);
	try {
		return [...(new Intl.Segmenter(language, { granularity: "word" }).segment(
			str))].reduce((words, { segment, isWordLike }) => { if (isWordLike) words.push(segment); return words; }, []);
	} catch (_) {
		return str.split(/\s+/).filter(Boolean);
	}
}

// Counts distinct capitalised tokens as a rough named-entity proxy. Returns 0 for non-Latin scripts.
function _roughNamedEntityCount(original, commonAcronyms, isLatin = true) {
	if (!isLatin) return 0;
	const acronymSet = new Set(commonAcronyms);
	const capitalised = String(original).match(/\b[A-Z][a-zA-Z0-9_-]{2,}\b/g) || [];
	return new Set(capitalised.filter(w => !acronymSet.has(w))).size;
}

// Returns a plain boolean or a debug object depending on options.debug.
function _respond(value, reasons, options) {
	if (!options.debug) return value;
	return { shouldTrim: value, reasons };
}

module.exports = { createTrimClassifier };
