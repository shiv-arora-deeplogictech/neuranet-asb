/**
 * LLM history based chat for Enterprise AI - simple GPT, not RAG. Useful
 * for pain GPT chats.
 * 
 * Request params
 * 	id - The user ID
 *  org - User's Org
 *  session_id - The session ID for a previous session if this is a continuation
 *  prompt - The chat prompt
 *  aiappid - The brain ID
 *  auto_summary - Set to true to reduce session size but can cause response errors
 *  <anything else> - Used to expand the prompt, including user's queries
 * 
 * The Response is an object
 *  result - true or false
 *  reason - set to one of the reasons if result is false
 *  response - the AI response, as a plain text
 *  session_id - the session ID which can be used to ask backend to maintain sessions
 * 
 * (C) 2023 TekMonks. All rights reserved.
 */

const mustache = require("mustache");
const llmchat = require(`${NEURANET_CONSTANTS.LIBDIR}/llmchat.js`);
const chatsessionmod = require(`${NEURANET_CONSTANTS.LIBDIR}/chatsession.js`);
const llmflowrunner = require(`${NEURANET_CONSTANTS.LIBDIR}/llmflowrunner.js`);
const pluginhandler = require(`${NEURANET_CONSTANTS.LIBDIR}/pluginhandler.js`);
const langdetector = require(`${NEURANET_CONSTANTS.THIRDPARTYDIR}/langdetector.js`);

const REASONS = llmflowrunner.REASONS;

/**
 * Runs the LLM. 
 * 
 * @param {Object} params Request params documented below
 * 	                          id - The user ID
 *                            org - User's Org
 *                            session_id - The session ID for a previous session if this is a continuation
 *                            prompt - The chat prompt
 * 							  question - The question asked
 * 							  files - Attached files to the question
 *							  brainid - The brain ID
 * 							  auto_summary - Set to true to reduce session size but can cause response errors
 * 							  model - The chat model to use, with overrides
 *                            <anything else> - Used to expand the prompt, including user's queries
 * @param {Object} _llmstepDefinition Not used.
 * 
 * @returns {Object} The Response is an object
 *  	                 result - true or false
 *  	                 reason - set to one of the reasons if result is false
 *  	                 response - the AI response, as a plain text
 *  	                 session_id - the session ID which can be used to ask backend to maintain sessions
 *  	                 metadatas - the response document metadatas. typically metadata.referencelink points
 * 					                 to the exact document
 */
exports.answer = async (params) => {
	const id = params.id, org = params.org, params_session_id = params.session_id, query_in = params.question, 
		aiappid = params.brainid||params.aiappid;

	LOG.debug(`Got llm GPT chat request from ID ${id} of org ${org}. Incoming params are ${JSON.stringify(params)}`);

	if (!(await llmchat.check_quota(id, org, aiappid))) {
		LOG.error(`Disallowing the LLM chat call, as the user ${id} is over their quota.`);
		return {reason: REASONS.LIMIT, ...CONSTANTS.FALSE_RESULT};
	}

	const {aiModelObject} = await llmchat.getAIModelAndObjectKeyAndLibrary(params.model, id, org, aiappid),
		aiModelObjectForChat = aiModelObject;
	if (!aiModelObjectForChat) {LOG.error("Bad AI Library or model"); return {reason: REASONS.BAD_MODEL, ...CONSTANTS.FALSE_RESULT}}
	
	const {sessionID} = chatsessionmod.getUsersChatSession(id, params_session_id);

	const llmdocchat = pluginhandler.getPlugin("llmdocchat");
	let filesForPrompt = await llmdocchat.getFilesForPrompt(params.files);
	
	const languageDetectedForQuestion =  langdetector.getISOLang(params.question);
	const promptTemplate =  params[`prompt_${languageDetectedForQuestion}`] || params.prompt;
	const promptWithQuestionAndFiles = mustache.render(promptTemplate, {...params, files: filesForPrompt}).trim();
	
	const paramsChat = { id, org, maintain_session: true, session_id: sessionID, model: aiModelObjectForChat,
        session: [{"role": aiModelObjectForChat.user_role, "content": promptWithQuestionAndFiles}],
		auto_chat_summary_enabled: params.auto_summary||false, raw_question: query_in, aiappid };
	const response = await llmchat.chat(paramsChat);

	return {...response};
}
