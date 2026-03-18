/**
 * Trims the session to [] when the classifier determines the incoming query is
 * standalone (not a follow-up to the previous conversation).
 *
 * Request params
 *   id             - The user ID
 *   org            - User's org
 *   session_id     - The session ID for the previous session (if any)
 *   query          - The incoming query
 *   brainid        - The brain ID (also accepted as aiappid)
 *   enablellmcheck - When true the classifier verdict is confirmed by an LLM call
 *   model          - The chat model descriptor (name + optional model_overrides)
 *   prompt         - Prompt template used for the LLM confirmation step
 *
 * Returns
 *   true  — session was trimmed (standalone query)
 *   false — session was kept   (follow-up query)
 *
 * (C) 2023 TekMonks. All rights reserved.
 */

const utils = require(`${CONSTANTS.LIBDIR}/utils.js`);
const quota = require(`${NEURANET_CONSTANTS.LIBDIR}/quota.js`);
const aiapp = require(`${NEURANET_CONSTANTS.LIBDIR}/aiapp.js`);
const chatsessionModule = require(`${NEURANET_CONSTANTS.LIBDIR}/chatsession.js`);
const simplellm = require(`${NEURANET_CONSTANTS.LIBDIR}/simplellm.js`);
const llmflowrunner = require(`${NEURANET_CONSTANTS.LIBDIR}/llmflowrunner.js`);
const langdetector = require(`${NEURANET_CONSTANTS.THIRDPARTYDIR}/langdetector.js`);
const { createTrimClassifier } = require(`${NEURANET_CONSTANTS.PLUGINSDIR}/sessionhandler/sessionTrimmerClassifier.js`);

const REASONS = llmflowrunner.REASONS, CHAT_MODEL_DEFAULT = "chat-knowledgebase-openai",
	DEBUG_MODE = NEURANET_CONSTANTS.CONF.debug_mode, DEFAULT_MAX_MEMORY_TOKENS = 1000;

// Instance of the classifier function created by sessionTrimmerClassifier.js
const _shouldTrimByClassifier = createTrimClassifier();

/**
 * Trims out the session to [] if the classifier determines the query is
 * standalone (not a follow-up). Optionally confirms the decision with an LLM.
 *
 * @param {Object} params Request params documented at the top of this file.
 * @returns {boolean} true if the session was trimmed, false if kept.
 */

exports.classifierTrimIfNeeded = async (params) => {
	const id = params.id, org = params.org, query_in = params.query,
		brainid = params.brainid || params.aiappid;
	const session_id = chatsessionModule.getUsersChatSession(params.id, params.session_id).sessionID;
	const enableLLMCheck = params.enablellmcheck || false;
		
	LOG.debug(`Got classifier-based auto session trim request for query '${query_in}' from ID ${id} of org ${org}.`);

	const aiappThis = await aiapp.getAIApp(id, org, brainid, true);
	if ((!aiappThis.disable_quota_checks) && (!(await quota.checkQuota(id, org, brainid)))) {
		LOG.error(`Disallowing the call, as the user ${id} of org ${org} is over their quota.`);
		params.return_error(REASONS.LIMIT); return;
	}

	const chatsession = chatsessionModule.getUsersChatSession(id, session_id).chatsession;
	if (!chatsession.length) {
		LOG.info(`Skipping classifier-based auto session trimming — no existing session for user ${id} of org ${org}.`);
		return true;  // no prior session — treat as standalone
	}

	// Serialize the session to a flat text block for the classifier.
	const sessionString = chatsession.map(entry => `${entry.role}: ${entry.content}`).join("\n");


	const languageDetectedForQuestion = langdetector.getISOLang(query_in);
	const shouldTrim = _shouldTrimByClassifier(query_in, sessionString, languageDetectedForQuestion);
	if (!shouldTrim) {
		LOG.info(`Auto session trimming skipped (classifier: follow-up) for '${query_in}' from ID ${id} of org ${org}.`);
		return false;
	}

	if (!enableLLMCheck) {
		// Classifier alone decides — trim immediately without LLM confirmation.
		const sessionUpdateResult = chatsessionModule.setUsersChatSession(id, session_id, []);
		if (sessionUpdateResult.result) LOG.info(`Auto session trimming performed (classifier only) for '${query_in}' from ID ${id} of org ${org}.`);
		else LOG.error(`Auto session trimming failed (classifier only) for '${query_in}' from ID ${id} of org ${org}. Error: ${sessionUpdateResult.error}.`);
		return sessionUpdateResult.result;
	}

	// Classifier says standalone — ask LLM to confirm before trimming.
	LOG.debug(`Classifier flagged standalone for '${query_in}', requesting LLM confirmation from ID ${id} of org ${org}.`);

	const aiModelToUseForChat = params.model.name || CHAT_MODEL_DEFAULT,
		aiModelObjectForChat = await aiapp.getAIModel(aiModelToUseForChat, params.model.model_overrides,
			params.id, params.org, brainid);
	const aiModuleToUse = `${NEURANET_CONSTANTS.LIBDIR}/${aiModelObjectForChat.driver.module}`;
	let aiLibrary; try { aiLibrary = utils.requireWithDebug(aiModuleToUse, DEBUG_MODE); } catch (err) {
		const errMsg = `Bad AI library or model — ${aiModuleToUse}, error: ${err}`;
		LOG.error(errMsg); params.return_error(errMsg); return;
	}

	const finalSessionObject = chatsession.length ? await chatsessionModule.trimSession(
		aiModelObjectForChat.max_memory_tokens || DEFAULT_MAX_MEMORY_TOKENS,
		chatsessionModule.jsonifyContentsInThisSession(chatsession), aiModelObjectForChat,
		aiModelObjectForChat.token_approximation_uplift, aiModelObjectForChat.tokenizer, aiLibrary) : [];
	if (finalSessionObject.length) finalSessionObject[finalSessionObject.length - 1].last = true;
	const inputTemperature = params.model?.model_overrides?.temperature;
	if (inputTemperature != undefined) aiModelObjectForChat.request.temperature = inputTemperature;

	const llmResponse = await simplellm.prompt_answer(
		params[`prompt_${languageDetectedForQuestion}`] || params.prompt, id, org, brainid,
		{ question: query_in, session: finalSessionObject, classifierVerdict: "standalone (true)", ...params },
		aiModelObjectForChat);
	if (!llmResponse) {
		LOG.error(`LLM did not confirm trim decision — keeping session for query: ${query_in}`);
		return false;
	}

	let trimResponse = llmResponse.trim().toLowerCase() === "true";
	if (trimResponse) {
		const sessionUpdateResult = chatsessionModule.setUsersChatSession(id, session_id, []);
		if (sessionUpdateResult.result) LOG.info(`Auto session trimming performed (classifier + LLM confirmed) for '${query_in}' from ID ${id} of org ${org}.`);
		else {
			LOG.error(`Auto session trimming failed for '${query_in}' from ID ${id} of org ${org}. Error: ${sessionUpdateResult.error}.`);
			trimResponse = false;
		}
	} else LOG.info(`LLM overrode classifier — keeping session (follow-up) for '${query_in}' from ID ${id} of org ${org}.`);

	return trimResponse;
}