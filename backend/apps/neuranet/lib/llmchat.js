/**
 * LLM based chat module. Can use any LLM.
 * 
 * Request params
 * 	id - the user ID
 *  org - the user org
 *  session - Array of [{"role":"user||assistant", "content":"[chat content]"}]
 *  maintain_session - If set to false, then session is not maintained
 *  session_id - The session ID for a previous session if this is a continuation else null
 *  auto_chat_summary_enabled - Optional, if true, LLM auto summarization is enabled to reduce session size
 *  aiappid - The calling ai app
 * 
 * Response object
 *  result - true or false
 *  reason - set to one of the reasons if result is false
 *  response - the AI response, as a plain text
 *  session_id - the session ID which can be used to ask backend to maintain sessions
 * 
 * (C) 2023 TekMonks. All rights reserved.
 */
const utils = require(`${CONSTANTS.LIBDIR}/utils.js`);
const crypt = require(`${CONSTANTS.LIBDIR}/crypt.js`);
const quota = require(`${NEURANET_CONSTANTS.LIBDIR}/quota.js`);
const aiapp = require(`${NEURANET_CONSTANTS.LIBDIR}/aiapp.js`);
const dblayer = require(`${NEURANET_CONSTANTS.LIBDIR}/dblayer.js`);

const REASONS = {INTERNAL: "internal", BAD_MODEL: "badmodel", OK: "ok", VALIDATION:"badrequest", LIMIT: "limit"}, 
	MODEL_DEFAULT = "chat-openai", CHAT_SESSION_UPDATE_TIMESTAMP_KEY = "__last_update",
	CHAT_SESSION_MEMORY_KEY_PREFIX = "__org_monkshu_neuranet_chatsession", 
	PROMPT_FILE_WITH_AUTO_SUMMARY = "chat_prompt_auto_summary.txt", PROMPT_FILE_NO_SUMMARY = "chat_prompt_no_summmary.txt",
	DEBUG_MODE = NEURANET_CONSTANTS.CONF.debug_mode, DEFAULT_MAX_MEMORY_TOKENS = 1000, 
	DEFAULT_SYSTEM_MESSAGE = "You are a helpful assistant";

exports.chat = async params => {
	if (!validateRequest(params)) {LOG.error("Validation failure."); return {reason: REASONS.VALIDATION, ...CONSTANTS.FALSE_RESULT};}

	LOG.debug(`Got chat request from ID ${params.id}. Incoming request is ${JSON.stringify(params)}`);

	const aiappThis = await aiapp.getAIApp(params.id, params.org, params.aiappid, true);
    if ((!aiappThis.disable_quota_checks) && (!(await quota.checkQuota(params.id, params.org, params.aiappid)))) {
		LOG.error(`Disallowing the LLM chat call, as the user ${params.id} is over their quota.`);
		return {reason: REASONS.LIMIT, ...CONSTANTS.FALSE_RESULT};
	}

	const aiModelToUse = params.model || MODEL_DEFAULT, 
		aiModelObject = typeof aiModelToUse === "object" ? aiModelToUse : 
			await aiapp.getAIModel(aiModelToUse, undefined, params.id, params.org, params.aiappid),
        aiKey = crypt.decrypt(aiModelObject.ai_key, NEURANET_CONSTANTS.CONF.crypt_key),
        aiModuleToUse = `${NEURANET_CONSTANTS.LIBDIR}/${aiModelObject.driver.module}`;
	let aiLibrary; try{aiLibrary = utils.requireWithDebug(aiModuleToUse, DEBUG_MODE);} catch (err) {
		LOG.error("Bad AI Library or model - "+aiModuleToUse); 
		return {reason: REASONS.BAD_MODEL, ...CONSTANTS.FALSE_RESULT};
	}
	
	const {chatsession, sessionID, sessionKey} = exports.getUsersChatSession(params.id, params.session_id);

	const jsonifiedSession = exports.jsonifyContentsInThisSession([...chatsession, ...(utils.clone(params.session))]);
	let finalSessionObject = await exports.trimSession(aiModelObject.max_memory_tokens||DEFAULT_MAX_MEMORY_TOKENS,
		jsonifiedSession, aiModelObject, aiModelObject.token_approximation_uplift, aiModelObject.tokenizer, aiLibrary); 
	if (!finalSessionObject.length) finalSessionObject = [jsonifiedSession[jsonifiedSession.length-1]];	// at least send the latest question
	finalSessionObject[finalSessionObject.length-1].last = true;
	
	const promptFile = `${NEURANET_CONSTANTS.TRAININGPROMPTSDIR}/${params.auto_chat_summary_enabled?PROMPT_FILE_WITH_AUTO_SUMMARY:PROMPT_FILE_NO_SUMMARY}`;
	const response = await aiLibrary.process({session: finalSessionObject, 
		system_message: aiModelObject.system_message?.trim()||DEFAULT_SYSTEM_MESSAGE}, promptFile, aiKey, aiModelToUse);

	if (!response) {
		LOG.error(`AI library error processing request ${JSON.stringify(params)}`); 
		return {reason: REASONS.INTERNAL, ...CONSTANTS.FALSE_RESULT};
	} else {
        if (!aiappThis.disable_model_usage_logging) dblayer.logUsage(params.id, response.metric_cost||0, aiModelToUse);
		else LOG.info(`ID ${params.id} of org ${params.org} used ${response.metric_cost||0} of AI quota. Not logged, as usage logging is disabled by app ${params.aiappid}`);
		const {aiResponse, promptSummary, responseSummary} = _unmarshallAIResponse(response.airesponse, 
			params.raw_question||params.session.at(-1).content, params.auto_chat_summary_enabled);
		if (params.maintain_session != false) {
			chatsession.push({"role": aiModelObject.user_role, "content": promptSummary}, 
				{"role": aiModelObject.assistant_role, "content": responseSummary});
			chatsession[CHAT_SESSION_UPDATE_TIMESTAMP_KEY] = Date.now();
			const idSessions = DISTRIBUTED_MEMORY.get(sessionKey, {}); idSessions[sessionID] = chatsession;
			DISTRIBUTED_MEMORY.set(sessionKey, idSessions);
			LOG.debug(`Chat session saved to the distributed memory is ${JSON.stringify(chatsession)}.`); 
		}
		return {response: aiResponse, reason: REASONS.OK, ...CONSTANTS.TRUE_RESULT, session_id: sessionID};
	}
}

exports.getUsersChatSession = (userid, session_id_in) => {
	let chatsession = []; const sessionID = session_id_in||Date.now(), 
		sessionKey = `${CHAT_SESSION_MEMORY_KEY_PREFIX}_${userid}`; 
	const idSessions = DISTRIBUTED_MEMORY.get(sessionKey, {}); chatsession = idSessions[sessionID]||[];
	LOG.debug(`Distributed memory key for this session is: ${sessionKey}.`);
	LOG.debug(`Chat session saved previously is ${JSON.stringify(chatsession)}.`); 
	return {chatsession: utils.clone(chatsession), sessionID, sessionKey};
}

exports.trimSession = async function(max_session_tokens, sessionObjects, aiModelObject, 
		token_approximation_uplift, tokenizer_name, tokenprocessor) {

	let tokensSoFar = 0; const sessionTrimmed = [];
	for (let i = sessionObjects.length - 1; i >= 0; i--) {
		const sessionObjectThis = sessionObjects[i];
		tokensSoFar = tokensSoFar + await tokenprocessor.countTokens(sessionObjectThis.content,
			aiModelObject.request.model, token_approximation_uplift, tokenizer_name);
		if (tokensSoFar > max_session_tokens) break;
		sessionTrimmed.unshift(sessionObjectThis);
	}
	return sessionTrimmed;
}

exports.jsonifyContentsInThisSession = session => {
	for (const sessionObject of session) try {JSON.parse(sessionObject.content);} catch (err) {
		const jsonStr = JSON.stringify(sessionObject.content), jsonifiedStr = jsonStr.substring(1, jsonStr.length-1);
		sessionObject.content = jsonifiedStr;
	}
	return session;
}

function _unmarshallAIResponse(response, userPrompt, chatAutoSummaryEnabled) {
	if (!chatAutoSummaryEnabled) {
		LOG.info(`_unmarshallAIResponse is returning unsummaried conversation as chat auto summarization is disabled.`);
		return {aiResponse: response, promptSummary: userPrompt, responseSummary: response};
	}

	try {
		const summaryRE = /\{["]*user["]*:\s*["]*(.*?)["]*,\s*["]*ai["]*:\s*["]*(.*?)["]*\}/g;
		const jsonSummaries = summaryRE.exec(response.trim());
		if (!jsonSummaries) throw new Error(`Error can't parse this response for summaries.\n ${response} `);
		const realResponse = response.replace(summaryRE, "");

		return {aiResponse: realResponse, promptSummary: jsonSummaries[1].trim(), 
			responseSummary: jsonSummaries[2].trim()};
	} catch (err) {
		LOG.error(`_unmarshallAIResponse is returning unsummaried conversation as error parsing the AI response summaries, the error is ${err}, the response is\n ${response}`);
		return {aiResponse: response, promptSummary: userPrompt, responseSummary: response};
	}	
}

const validateRequest = params => (params && params.id && params.org && params.session && 
	Array.isArray(params.session) && params.session.length >= 1);