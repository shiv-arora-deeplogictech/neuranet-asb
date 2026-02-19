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

const llmchat = require(`${NEURANET_CONSTANTS.LIBDIR}/llmchat.js`);
const simplellm = require(`${NEURANET_CONSTANTS.LIBDIR}/simplellm.js`);
const sseevents = require(`${NEURANET_CONSTANTS.APIDIR}/sseevents.js`);
const chatsessionmod = require(`${NEURANET_CONSTANTS.LIBDIR}/chatsession.js`);
const llmflowrunner = require(`${NEURANET_CONSTANTS.LIBDIR}/llmflowrunner.js`);
const langdetector = require(`${NEURANET_CONSTANTS.THIRDPARTYDIR}/langdetector.js`);

const REASONS = llmflowrunner.REASONS;

/**
 * Expands the query.
 * 
 * @param {Object} params Request params documented below
 * 	                        id - The user ID
 * 	                        org - User's Org
 * 	                        session_id - The session ID for a previous session if this is a continuation
 * 							message_id - The message ID - always comes from the frontend for all messages
 * 	                        query - The incoming query
 * 	                        brainid - The brain ID
 * 
 * @returns {string} The expanded query or the original query if the expansion failed.
 */
exports.expand = async (params) => {
	const id = params.id, org = params.org, params_session_id = params.session_id, query_in = params.query, 
		brainid = params.brainid||params.aiappid, forceExpansion = params.force_expansion, message_id = params.message_id;

	LOG.debug(`Got query expansion for query ${query_in} from ID ${id} of org ${org}.`);

	if (!(await llmchat.check_quota(id, org, brainid))) {
		LOG.error(`Disallowing the LLM chat call, as the user ${id} is over their quota.`);
		return {reason: REASONS.LIMIT, ...CONSTANTS.FALSE_RESULT};
	}

	const {chatsession, sessionID} = chatsessionmod.getUsersChatSession(id, params_session_id);
    if (!chatsession.length && (!forceExpansion)) {
        LOG.info(`Query expansion is returning the original query '${query_in}' due to no existing session for the user ${id} of org ${org}.`)
        return query_in;
    }

	const {aiModelObject, aiLibrary} = await llmchat.getAIModelAndObjectKeyAndLibrary(params.model, params.id, params.org, params.aiappid);
	if ((!aiModelObject) || (!aiLibrary)) {LOG.error("Bad AI library or model - "+params.model); return {reason: REASONS.BAD_MODEL, ...CONSTANTS.FALSE_RESULT}}
	
    const finalSessionObject = await chatsessionmod.getFinalSessionObject(id, sessionID, aiModelObject, aiLibrary);
	const flatSession = []; for (const sessionObject of finalSessionObject) {
		const flatSessionObject = {}; flatSessionObject[sessionObject.role] = sessionObject.content;
		flatSession.push(flatSessionObject);
	}

	const languageDetectedForQuestion =  langdetector.getISOLang(query_in)

	let expandedQuery; if (finalSessionObject.length > 0 || forceExpansion) {  // run expansion if either session is there or force expansion call
        expandedQuery = await simplellm.prompt_answer(
            params[`prompt_${languageDetectedForQuestion}`] || params.prompt, id, org, brainid,
			{flatsession: flatSession, session: finalSessionObject, question: query_in, ...params}, 
			aiModelObject);
		if (!expandedQuery) LOG.error("Couldn't expand the query, continuing with the originial query.");
		else if (message_id) sseevents.emitThought(id, org, message_id, `I have figured out the user wants me to provide information for this question\n${expandedQuery}`);
    }

	LOG.info(sessionID, `The query expansion for query '${query_in}' from ID ${id} of org ${org} is: '${expandedQuery}'`);
    return expandedQuery || query_in;
}
