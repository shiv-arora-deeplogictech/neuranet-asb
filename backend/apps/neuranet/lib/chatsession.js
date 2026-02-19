
/**
 * Maintains the user's chat session in the backend and related functions.
 * 
 * (C) 2023 TekMonks. All rights reserved.
 */

const utils = require(`${CONSTANTS.LIBDIR}/utils.js`);

const CHAT_SESSION_UPDATE_TIMESTAMP_KEY = "__last_update",
	CHAT_SESSION_MEMORY_KEY_PREFIX = "__org_monkshu_neuranet_chatsession", DEFAULT_MAX_MEMORY_TOKENS = 1000;

exports.getFinalSessionObject = async (id, session_id_in, aiModelObject, aiLibrary, session_additional=[]) => {
    const {chatsession} = exports.getUsersChatSession(id, session_id_in)||[];
	const jsonifiedSession = exports.jsonifyContentsInThisSession([...chatsession, ...(utils.clone(session_additional))]);
	let finalSessionObject = await exports.trimSession(aiModelObject.max_memory_tokens||DEFAULT_MAX_MEMORY_TOKENS,
		jsonifiedSession, aiModelObject, aiModelObject.token_approximation_uplift, aiModelObject.tokenizer, aiLibrary); 
	if (!finalSessionObject.length) finalSessionObject = [jsonifiedSession[jsonifiedSession.length-1]];	// at least send the latest question
	finalSessionObject[finalSessionObject.length-1].last = true;
    return finalSessionObject;
}

exports.getUsersChatSession = (userid, session_id_in) => {
	let chatsession = []; const sessionID = session_id_in||Date.now(), 
		sessionKey = `${CHAT_SESSION_MEMORY_KEY_PREFIX}_${userid}`; 
	const idSessions = DISTRIBUTED_MEMORY.get(sessionKey, {}); chatsession = idSessions[sessionID]||[];
	LOG.debug(`Distributed memory key for this session is: ${sessionKey}.`);
	LOG.debug(`Chat session saved previously is ${JSON.stringify(chatsession)}.`); 
	return {chatsession: utils.clone(chatsession)||[], sessionID, sessionKey};
}

exports.setUsersChatSession = (userid, session_id_in, chatsessionToSet) => {
	const sessionID = session_id_in,  // not generating any new session ID if not exists, as it's an update call not a get call
		sessionKey = `${CHAT_SESSION_MEMORY_KEY_PREFIX}_${userid}`; 
	if (!session_id_in || typeof session_id_in !== "number")  // No need to update & return the empty sessions if not a valid session ID mentioned
		return {result: true, chatsession: [], sessionID, sessionKey};
	if (!Array.isArray(chatsessionToSet))  // handling for an invalid chatsessionToSet
		return {result: false, error: "Invalid chatsession to set: Not an Array", sessionID, sessionKey};

	try{
		LOG.debug(`Distributed memory key for this session is: ${sessionKey}.`);
		const idSessions = utils.clone(DISTRIBUTED_MEMORY.get(sessionKey, {}));  // prevent shared mutation
		idSessions[sessionID] = chatsessionToSet;
		DISTRIBUTED_MEMORY.set(sessionKey, idSessions);
		LOG.debug(`Chat session updated. Messages=${chatsessionToSet.length}`);
		return {result: true, chatsession: utils.clone(chatsessionToSet), sessionID, sessionKey};
	} catch (error) {
		LOG.debug(`Failed to update the Chat session for Distributed memory key: ${sessionKey} & incoming sessionID: ${sessionID}.`);
		return {result: false, error: error.message, sessionID, sessionKey};
	}
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
		const jsonStr = JSON.stringify(sessionObject.content), jsonifiedStr = jsonStr ? jsonStr.substring(1, jsonStr.length-1) : "";
		sessionObject.content = jsonifiedStr;
	}
	return session;
}

exports.addToSession = (question, answer, userid, session_id_in, user_role, assistant_role) => {
	let chatsession = []; const sessionID = session_id_in||Date.now(), 
		sessionKey = `${CHAT_SESSION_MEMORY_KEY_PREFIX}_${userid}`; 
	const idSessions = DISTRIBUTED_MEMORY.get(sessionKey, {}); chatsession = idSessions[sessionID]||[];
	chatsession.push({"role": user_role, "content": question}, {"role": assistant_role, "content": answer});
	chatsession[CHAT_SESSION_UPDATE_TIMESTAMP_KEY] = Date.now();
	idSessions[sessionID] = chatsession;
	DISTRIBUTED_MEMORY.set(sessionKey, idSessions);
	LOG.debug(`Chat session saved to the distributed memory is ${JSON.stringify(chatsession)}.`); 
}