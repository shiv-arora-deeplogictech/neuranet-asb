/**
 * API endpoint to run LLM flows.
 * 
 * API Request
 * 	id - The user ID
 *  org - The user org
 *  aiappid - The AI app to use, if not provided then the org's default app is used
 *  question - The user's question
 *  flow - The flow section of AI app to call, if null then llm_flow section is used as default
 *  session_id - The session ID for a previous session if this is a continuation
 * 
 * API Response
 *  result - true or false
 *  reason - set to one of the reasons if result is false
 *  response - the AI response, as a plain text
 *  session_id - the session ID which can be used to ask backend to maintain sessions
 *  metadatas - the response document metadatas. typically metadata.referencelink points
 * 				to the exact document
 * 
 * (C) 2023 TekMonks. All rights reserved.
 * License: See the enclosed LICENSE file.
 */

const aiapp = require(`${NEURANET_CONSTANTS.LIBDIR}/aiapp.js`);
const timedcache = require(`${CONSTANTS.LIBDIR}/timedcache.js`);
const brainhandler = require(`${NEURANET_CONSTANTS.LIBDIR}/brainhandler.js`);
const llmflowrunner = require(`${NEURANET_CONSTANTS.LIBDIR}/llmflowrunner.js`);

const TIMED_CACHE = timedcache.newcache(NEURANET_CONSTANTS.CONF.apicache_expiry), STATUS_WAITING = "waiting";

exports.doService = async (jsonReq, _servObject, _headers, _url) => {
	if (!validateRequest(jsonReq)) {
        LOG.error("Validation failure."); return {reason: llmflowrunner.REASONS.VALIDATION, ...CONSTANTS.FALSE_RESULT};}

	LOG.debug(`Got a chat request from ID ${jsonReq.id}. Incoming request is ${JSON.stringify(jsonReq)}`);
    
    const _getResult = async _ => { 
        const extraInfo = brainhandler.createExtraInfo(jsonReq.id, jsonReq.org.toLowerCase(), jsonReq.aiappid);
        const aiappid = await aiapp.getAppID(jsonReq.id, jsonReq.org.toLowerCase(), extraInfo);
        const result = await llmflowrunner[aiapp.DEFAULT_ENTRY_FUNCTIONS.llm_flow](
            jsonReq.question, jsonReq.id, jsonReq.org, aiappid, jsonReq, jsonReq.flow||llmflowrunner.DEFAULT_LLM_FLOW);
        
        if (!jsonReq.jobrequest) return result; else TIMED_CACHE.set(polledResponseID, result);
    }

    const polledResponseID = jsonReq.message_id; if (jsonReq.jobrequest) {
        TIMED_CACHE.set(polledResponseID, {...CONSTANTS.TRUE_RESULT, status: STATUS_WAITING, message_id: jsonReq.message_id});
        _getResult(); return TIMED_CACHE.get(polledResponseID); 
    }
    if (jsonReq.jobresponse) {
        if (TIMED_CACHE.get(polledResponseID)) return TIMED_CACHE.get(polledResponseID); 
        else return {reason: llmflowrunner.REASONS.NO_JOB, ...CONSTANTS.FALSE_RESULT}; // we do not know of this job
    }

    return await _getResult();  // coming here means no job control was specified so just run the request and return the results
}

const validateRequest = jsonReq => (jsonReq && jsonReq.id && jsonReq.question && jsonReq.org);