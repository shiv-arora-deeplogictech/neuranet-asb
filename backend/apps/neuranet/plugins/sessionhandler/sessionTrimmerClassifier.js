/**
 * sessionTrimmerClassifier.js
 *
 * Heuristic classifier that decides whether it is safe to trim (discard) the previous chat session before processing a new user question.
 *
 * Return values
 *   true  => SAFE TO TRIM  — question is standalone, session is not needed
 *   false => NOT SAFE TO TRIM — question is a follow-up, session must be kept
 *
 * How it works (three-phase pipeline)
 * ------------------------------------
 *  Phase 1 — Hard rules (immediate false if any match)
 *    Explicit prior-context references, continuation verbs, deictic+edit combos.
 *    Any match => false (not safe to trim).
 *
 *  Phase 2 — Soft scoring (accumulated evidence)
 *    Each signal adds or subtracts from a numeric score.
 *    Score table (higher = more follow-up evidence):
 *
 *  Phase 3 — Decision
 *    score >= threshold                       => false (follow-up)
 *    score in borderline band [threshold-borderline_margin, threshold) => false (conservative)
 *    score < lower bound                      => true  (standalone, safe to trim)
 *
 * Options (passed to createTrimClassifier, override conf defaults)
 *   threshold        {number}  Score at which a question is treated as follow-up.
 *   borderlineMargin {number}  Band below threshold also treated as follow-up.
 *   debug            {boolean} When true, returns { shouldTrim, reasons } instead of a boolean.
 *   extraCues        {Object}  Extra word/phrase arrays merged into the built-in cue banks.
 *
 * (C) 2023 TekMonks. All rights reserved.
 */

const conf = require(`${NEURANET_CONSTANTS.PLUGINSDIR}/sessionhandler/sessionhandler.json`);

/**
 * Creates and returns a classifier function.
 *
 * @param {Object} userOptions - Optional overrides (threshold, borderlineMargin, debug, extraCues).
 * @returns {Function} classify(newQuestion, previousConversation?) => boolean (or debug object)
 */
function createTrimClassifier(userOptions = {}) {
	const classifierConf = conf.classifier;
	const options = {
		threshold:        classifierConf.threshold,
		borderlineMargin: classifierConf.borderline_margin,
		debug:            false,
		extraCues:        {},
		...userOptions
	};

	const scoring        = classifierConf.scoring;
	const tokenThresh    = classifierConf.token_thresholds;
	const inlineConf     = classifierConf.inline_context;
	const commonAcronyms = classifierConf.common_acronyms;

	// Build cue word/phrase lists and compile all regexes once at creation time.
	const cues = _buildCues(options.extraCues);
	const re   = _compileRegexes(cues);

	/**
	 * Classify whether the session can be safely trimmed for the given question.
	 *
	 * @param {string} newQuestion          - The incoming user question.
	 * @param {string} [previousConversation=""] - Serialized prior chat session text.
	 * @returns {boolean|Object} true = safe to trim, false = keep session.
	 *                           In debug mode returns { shouldTrim: boolean, reasons: string[] }.
	 */
	function classify(newQuestion, previousConversation = "") {
		const qRaw     = String(newQuestion         || "").trim();
		const sRaw     = String(previousConversation || "").trim();
		const hasSession = sRaw.length > 0;
		const reasons  = [];

		// Empty question — nothing to follow up on.
		if (!qRaw) return _respond(true, ["empty-question => standalone"], options);

		// Strip code blocks and quoted text before pattern matching to avoid
		// false positives from pasted content inside the question.
		const q = _stripCodeAndQuotes(qRaw).toLowerCase();

		// Check whether the user pasted inline context (code, many lines, quotes…).
		// If they did, references inside the text are self-contained, not session references.
		const hasInlineContext = _providesContextInline(qRaw, inlineConf);
		if (hasInlineContext) reasons.push("inline-context-present");

		/* -------------------------------------------------------------------
		   Phase 1: Hard rules — explicit prior-context signals.
		   Each rule returns immediately on a match (no scoring needed).
		   ------------------------------------------------------------------- */

		// Direct reference to the prior conversation ("as you said", "from before", "that one"…)
		if (re.strongPrevRef.test(q)) {
			reasons.push("hard-rule: strong previous reference");
			return _respond(false, reasons, options);
		}

		// Asks to summarize, rewrite, or verify something from the session.
		if (re.summarizeRewriteVerifyPrev.test(q)) {
			reasons.push("hard-rule: summarize/rewrite/verify previous");
			return _respond(false, reasons, options);
		}

		// "fix/explain/update THIS code/query/answer" — clearly refers to something in session.
		if (!hasInlineContext && re.editVerb.test(q) && re.objectRef.test(q) && re.deictic.test(q)) {
			reasons.push("hard-rule: edit verb + object + deictic without inline context");
			return _respond(false, reasons, options);
		}

		// "continue / proceed / go on / carry on" — explicit continuation request.
		if (!hasInlineContext && re.continueVerb.test(q)) {
			reasons.push("hard-rule: continuation verb without inline context");
			return _respond(false, reasons, options);
		}

		/* -------------------------------------------------------------------
		   Phase 2: Soft scoring — accumulate follow-up evidence.
		   Positive score = more likely a follow-up (keep session).
		   Negative score = more likely standalone (safe to trim).
		   ------------------------------------------------------------------- */

		let score = 0;

		// Starts with a continuation opener ("And", "So", "Also", "Then"…)
		if (re.continuationStart.test(q)) {
			score += scoring.continuation_start;
			reasons.push(`score +${scoring.continuation_start}: starts with continuation word`);
		}

		// Deictic references ("this", "that", "these", "the above"…)
		const deicticCount = _countMatches(re.deicticGlobal, q);
		if (deicticCount > 0) {
			const deicticScore = Math.min(scoring.deictic_cap, scoring.deictic_per_word * deicticCount);
			score += deicticScore;
			reasons.push(`score +${deicticScore.toFixed(1)}: deictic words (count: ${deicticCount})`);
		}

		// Ambiguous pronouns ("it", "they", "them", "there"…)
		const pronounCount = _countMatches(re.pronounGlobal, q);
		if (pronounCount > 0) {
			const pronounScore = Math.min(scoring.pronoun_cap, scoring.pronoun_per_word * pronounCount);
			score += pronounScore;
			reasons.push(`score +${pronounScore.toFixed(1)}: ambiguous pronouns (count: ${pronounCount})`);
		}

		// Repetition cues ("again", "still", "same", "as well"…)
		if (re.repetitionCue.test(q)) {
			score += scoring.repetition_cue;
			reasons.push(`score +${scoring.repetition_cue}: repetition cue`);
		}

		// Edit verb paired with an object reference ("fix the code", "update the query"…)
		if (re.editVerb.test(q) && re.objectRef.test(q)) {
			score += scoring.edit_verb_with_object;
			reasons.push(`score +${scoring.edit_verb_with_object}: edit verb + object reference`);
		}

		// Question length — shorter questions are more likely to be follow-ups.
		const tokenCount = _tokenize(q).length;
		if (tokenCount <= tokenThresh.very_short) {
			score += scoring.very_short_question;
			reasons.push(`score +${scoring.very_short_question}: very short question (${tokenCount} tokens)`);
		} else if (tokenCount <= tokenThresh.short) {
			score += scoring.short_question;
			reasons.push(`score +${scoring.short_question}: short question (${tokenCount} tokens)`);
		} else if (tokenCount >= tokenThresh.long) {
			score += scoring.long_question;
			reasons.push(`score ${scoring.long_question}: long question (${tokenCount} tokens)`);
		}

		// Named entities — more proper nouns suggest a fresh, self-contained topic.
		const namedEntityCount = _roughNamedEntityCount(qRaw, commonAcronyms);
		if (namedEntityCount >= tokenThresh.min_named_entities) {
			score += scoring.named_entities;
			reasons.push(`score ${scoring.named_entities}: named entities found (count: ${namedEntityCount})`);
		}

		// No prior session — nothing to follow up on, relax the threshold slightly.
		if (!hasSession) {
			score += scoring.no_session;
			reasons.push(`score ${scoring.no_session}: no session present`);
		}

		// User included their own context inline — references are self-contained, not session refs.
		if (hasInlineContext) {
			score += scoring.inline_context;
			reasons.push(`score ${scoring.inline_context}: inline context provided by user`);
		}

		// Anaphoric reference while a session exists — be conservative, keep session.
		if (hasSession && !hasInlineContext && (deicticCount > 0 || pronounCount > 0)) {
			score += scoring.anaphoric_with_session;
			reasons.push(`score +${scoring.anaphoric_with_session}: session exists + anaphoric reference (conservative bump)`);
		}

		/* -------------------------------------------------------------------
		   Phase 3: Decision — apply threshold with a conservative borderline band.
		   ------------------------------------------------------------------- */

		const { threshold, borderlineMargin } = options;
		const lowerBound = threshold - borderlineMargin;

		if (score >= threshold) {
			reasons.push(`decision: follow-up (score ${score.toFixed(2)} >= threshold ${threshold})`);
			return _respond(false, reasons, options);
		}

		if (score >= lowerBound) {
			reasons.push(`decision: borderline follow-up (score ${score.toFixed(2)} in [${lowerBound.toFixed(2)}, ${threshold}))`);
			return _respond(false, reasons, options);
		}

		reasons.push(`decision: standalone (score ${score.toFixed(2)} < lower bound ${lowerBound.toFixed(2)})`);
		return _respond(true, reasons, options);
	}

	return classify;
}

/**
 * Builds the cue word/phrase lists from conf, merging any user-supplied extras.
 *
 * @param {Object} extra - Extra arrays keyed by cue group name.
 * @returns {Object} Merged cue banks.
 */
function _buildCues(extra = {}) {
	const baseCues = conf.classifier.cues;
	const base = {
		strongPrevRef:              [...baseCues.strongPrevRef],
		summarizeRewriteVerifyPrev: [...baseCues.summarizeRewriteVerifyPrev],
		continuationStarters:       [...baseCues.continuationStarters],
		deictics:                   [...baseCues.deictics],
		repetitionCues:             [...baseCues.repetitionCues],
		editVerbs:                  [...baseCues.editVerbs],
		continueVerbs:              [...baseCues.continueVerbs],
		objectRefs:                 [...baseCues.objectRefs],
		pronouns:                   [...baseCues.pronouns]
	};

	// Merge any extra cues supplied by the caller, deduplicating values.
	for (const key of Object.keys(extra || {})) {
		if (!Array.isArray(extra[key])) continue;
		base[key] = Array.from(new Set([...(base[key] || []), ...extra[key]]));
	}

	return base;
}

/**
 * Compiles all cue lists into RegExp objects. Called once per classifier instance.
 *
 * @param {Object} cues - Cue banks from _buildCues().
 * @returns {Object} Named regex map.
 */
function _compileRegexes(cues) {
	return {
		strongPrevRef:              _phraseUnionRegex(cues.strongPrevRef,              "i"),
		summarizeRewriteVerifyPrev: _phraseUnionRegex(cues.summarizeRewriteVerifyPrev, "i"),
		continuationStart:          new RegExp(`^\\s*(${cues.continuationStarters.map(_escapeRegex).join("|")})\\b`, "i"),
		deictic:                    _phraseUnionRegex(cues.deictics,       "i"),
		deicticGlobal:              _phraseUnionRegex(cues.deictics,       "ig"),
		repetitionCue:              _phraseUnionRegex(cues.repetitionCues, "i"),
		editVerb:                   _phraseUnionRegex(cues.editVerbs,      "i"),
		continueVerb:               _phraseUnionRegex(cues.continueVerbs,  "i"),
		objectRef:                  _phraseUnionRegex(cues.objectRefs,     "i"),
		pronounGlobal:              _phraseUnionRegex(cues.pronouns,       "ig")
	};
}


/**
 * Builds a single regex that matches any phrase in the list.
 * Single words use \b word boundaries; multi-word phrases allow flexible whitespace.
 *
 * @param {string[]} phrases - Words or phrases to match.
 * @param {string}   flags   - RegExp flags (e.g. "i" or "ig").
 * @returns {RegExp}
 */
function _phraseUnionRegex(phrases, flags) {
	const parts = (phrases || []).map(p => {
		const s = String(p).trim();
		if (!s) return null;
		// Multi-word phrase — allow one or more spaces between words.
		if (/\s/.test(s)) return s.split(/\s+/).map(_escapeRegex).join("\\s+");
		// Single word — require word boundaries.
		return `\\b${_escapeRegex(s)}\\b`;
	}).filter(Boolean);

	// Return a never-matching regex when the list is empty.
	if (!parts.length) return /$a/;

	return new RegExp(`(?:${parts.join("|")})`, flags);
}

/**
 * Escapes all regex special characters in a string.
 *
 * @param {string} s
 * @returns {string}
 */
function _escapeRegex(s) {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Removes fenced code blocks, inline code, and blockquotes from a string so
 * that pattern matching is not tricked by pasted content inside the question.
 *
 * @param {string} s - Raw question text.
 * @returns {string} Cleaned text with code/quote sections replaced by a space.
 */
function _stripCodeAndQuotes(s) {
	return String(s)
		.replace(/```[\s\S]*?```/g, " ")           // fenced code blocks
		.replace(/`[^`]*`/g, " ")                  // inline code
		.replace(/(^|\n)\s*>.*(\n\s*>.*)*/g, " ")  // blockquotes
		.replace(/\s+/g, " ")
		.trim();
}

/**
 * Returns true if the question itself contains substantial inline context,
 * meaning any references in it are self-contained rather than session references.
 *
 * Signals detected:
 *   - Fenced code block (```) pasted in the question
 *   - min_lines or more non-empty lines (likely pasted text)
 *   - "Here is / below is / following:" followed by min_chars_after_colon+ characters
 *   - A long quoted string (min_chars_in_quotes+ chars inside quotes)
 *
 * @param {string} raw        - Original (unstripped) question text.
 * @param {Object} inlineConf - Inline context thresholds from conf.
 * @returns {boolean}
 */
function _providesContextInline(raw, inlineConf) {
	const s = String(raw);

	if (/```[\s\S]*?```/.test(s)) return true;

	const nonEmptyLines = s.split(/\r?\n/).filter(l => l.trim().length > 0);
	if (nonEmptyLines.length >= inlineConf.min_lines) return true;

	const lower = s.toLowerCase();
	const colonIdx = lower.search(/\b(here\s*(is|are)|below\s*(is|are)|following)\b\s*:/);
	if (colonIdx >= 0) {
		const afterColon = s.slice(s.indexOf(":") + 1).trim();
		if (afterColon.length >= inlineConf.min_chars_after_colon) return true;
	}

	const minQ = inlineConf.min_chars_in_quotes;
	if (new RegExp(`"[^"]{${minQ},}"`).test(s) || new RegExp(`'[^']{${minQ},}'`).test(s)) return true;

	return false;
}

/**
 * Splits text into word tokens for length-based scoring.
 *
 * @param {string} s
 * @returns {string[]}
 */
function _tokenize(s) {
	return String(s).split(/[\s,.;:!?(){}\[\]"']+/).filter(Boolean);
}

/**
 * Counts all non-overlapping matches of a global regex in text.
 * Resets lastIndex before counting to ensure correct results.
 *
 * @param {RegExp} regexGlobal - Must have the global flag set.
 * @param {string} text
 * @returns {number}
 */
function _countMatches(regexGlobal, text) {
	if (!regexGlobal.global) throw new Error("_countMatches requires a regex with the global flag.");
	regexGlobal.lastIndex = 0;
	let count = 0;
	while (regexGlobal.exec(text)) count++;
	return count;
}

/**
 * Counts distinct capitalised tokens in the original (un-lowercased) question as
 * a rough proxy for named entities. More named entities => more likely a fresh topic.
 *
 * @param {string}   original      - Original question text (not lowercased).
 * @param {string[]} commonAcronyms - Acronyms to exclude from the count (from conf).
 * @returns {number} Count of distinct capitalised tokens.
 */
function _roughNamedEntityCount(original, commonAcronyms) {
	const acronymSet  = new Set(commonAcronyms);
	const capitalised = String(original).match(/\b[A-Z][a-zA-Z0-9_-]{2,}\b/g) || [];
	const distinct    = new Set(capitalised.filter(w => !acronymSet.has(w)));
	return distinct.size;
}

/**
 * Returns either a plain boolean or a debug object depending on options.debug.
 *
 * @param {boolean}  value   - The classification result.
 * @param {string[]} reasons - Collected reasoning labels.
 * @param {Object}   options - Classifier options (checked for debug flag).
 * @returns {boolean|{shouldTrim: boolean, reasons: string[]}}
 */
function _respond(value, reasons, options) {
	if (!options.debug) return value;
	return { shouldTrim: value, reasons };
}

module.exports = { createTrimClassifier };