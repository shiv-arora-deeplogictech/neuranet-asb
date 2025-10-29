/**
 * Expands the user's query.
 * 
 * Request params
 * 	id - The user ID
 *  org - User's Org
 *  session_id - The session ID for a previous session if this is a continuation
 *  query - The incoming query
 *  brainid - The brain ID
 * 
 * The Response is a string containing the expanded query or the original query if
 * the expansion failed.
 * 
 * (C) 2023 TekMonks. All rights reserved.
 */

const utils = require(`${CONSTANTS.LIBDIR}/utils.js`);
const quota = require(`${NEURANET_CONSTANTS.LIBDIR}/quota.js`);
const aiapp = require(`${NEURANET_CONSTANTS.LIBDIR}/aiapp.js`);
const llmchat = require(`${NEURANET_CONSTANTS.LIBDIR}/llmchat.js`);
const llmflowrunner = require(`${NEURANET_CONSTANTS.LIBDIR}/llmflowrunner.js`);
const langdetector = require(`${NEURANET_CONSTANTS.THIRDPARTYDIR}/langdetector.js`);
const simplellm = require(`${NEURANET_CONSTANTS.LIBDIR}/simplellm.js`);

const REASONS = llmflowrunner.REASONS, CHAT_MODEL_DEFAULT = "chat-knowledgebase-openai", 
    DEBUG_MODE = NEURANET_CONSTANTS.CONF.debug_mode, DEFAULT_MAX_MEMORY_TOKENS = 1000;

/**
 * Expands the query.
 * 
 * @param {Object} params Request params documented below
 * 	                        id - The user ID
 * 	                        org - User's Org
 * 	                        session_id - The session ID for a previous session if this is a continuation
 * 	                        query - The incoming query
 * 	                        brainid - The brain ID
 * 
 * @returns {string} The expanded query or the original query if the expansion failed.
 */
exports.expand = async (params) => {
	const id = params.id, org = params.org, session_id = params.session_id, query_in = params.query, 
		brainid = params.brainid||params.aiappid, forceExpansion = params.force_expansion;

	LOG.debug(`Got query expansion for query ${query_in} from ID ${id} of org ${org}.`);

	const aiappThis = await aiapp.getAIApp(id, org, brainid, true);
    if ((!aiappThis.disable_quota_checks) && (!(await quota.checkQuota(id, org, brainid)))) {
		LOG.error(`Disallowing the call, as the user ${id} of org ${org} is over their quota.`);
        params.return_error(REASONS.LIMIT); return;
	}

	const chatsession = llmchat.getUsersChatSession(id, session_id).chatsession;
    if (!chatsession.length && (!forceExpansion)) {
        LOG.info(`Query expansion is returning the original query '${query_in}' due to no existing session for the user ${id} of org ${org}.`)
        return query_in;
    }

	const aiModelToUseForChat = params.model.name||CHAT_MODEL_DEFAULT, 
		aiModelObjectForChat = await aiapp.getAIModel(aiModelToUseForChat, params.model.model_overrides, 
			params.id, params.org, brainid);
	const aiModuleToUse = `${NEURANET_CONSTANTS.LIBDIR}/${aiModelObjectForChat.driver.module}`
	let aiLibrary; try{aiLibrary = utils.requireWithDebug(aiModuleToUse, DEBUG_MODE);} catch (err) {
		const errMsg = "Bad AI Library or model - "+aiModuleToUse+", error: "+err;
        LOG.error(errMsg); params.return_error(errMsg); return;
	}
	const finalSessionObject = chatsession.length ? await llmchat.trimSession(
		aiModelObjectForChat.max_memory_tokens||DEFAULT_MAX_MEMORY_TOKENS,
		llmchat.jsonifyContentsInThisSession(chatsession), aiModelObjectForChat, 
		aiModelObjectForChat.token_approximation_uplift, aiModelObjectForChat.tokenizer, aiLibrary) : [];
	if (finalSessionObject.length) finalSessionObject[finalSessionObject.length-1].last = true;
	const flatSession = []; for (const sessionObject of finalSessionObject) {
		const flatSessionObject = {}; flatSessionObject[sessionObject.role] = sessionObject.content;
		flatSession.push(flatSessionObject);
	}

	const languageDetectedForQuestion =  langdetector.getISOLang(query_in)

	let expandedQuery; if (finalSessionObject.length > 0) {
        expandedQuery = await simplellm.prompt_answer(
            params[`prompt_${languageDetectedForQuestion}`] || params.prompt, id, org, brainid,
			{flatsession: flatSession, session: finalSessionObject, question: query_in, ...params}, 
			aiModelObjectForChat);
		if (!expandedQuery) LOG.error("Couldn't expand the query, continuing with the originial query.");
    }

	LOG.info(`The query expansion for query '${query_in}' from ID ${id} of org ${org} is: '${expandedQuery}'`);
    return expandedQuery || query_in;
}
