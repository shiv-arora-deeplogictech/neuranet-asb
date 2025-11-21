/**
 * Runs ASB flows and provides answers. Injects the message into ASB with this format
 * {question, raw_question, session, aimodeltouse, aimodelobject, aikey, ailibrary}
 * 
 * @param {Object} params Request params documented below
 * 	                          id - The user ID
 *                            org - User's Org
 *                            session_id - The session ID for a previous session if this is a continuation
 * 							  session - Array of [{"role":"user||assistant", "content":"[chat content]"}]
 *                            raw_question - The raw question from the user
 * 							  files - Attached files to the question
 *							  aiappid - The calling ai app
 *                            model - The recommended AI model to use for the flow (could be ignored by some steps)
 *                            flow - The AI flow to run
 * 
 * @returns {Object} The Response is an object
 *  	                 result - true or false
 *  	                 reason - set to one of the reasons if result is false
 *  	                 response - the AI response, as a plain text or json object for rich responses
 *  	                 session_id - the session ID which can be used to ask backend to maintain sessions
 *  	                 metadatas - If applicable, the response document metadatas. Typically metadata. 
 *                                   Referencelink points to the exact document
 */

const llmchat = require(`${NEURANET_CONSTANTS.LIBDIR}/llmchat.js`);
const simplellm = require(`${NEURANET_CONSTANTS.LIBDIR}/simplellm.js`);
const chatsession = require(`${NEURANET_CONSTANTS.LIBDIR}/chatsession.js`);
const asb = require(`${NEURANET_CONSTANTS.THIRDPARTYDIR}/asb/lib/main.js`);
const pluginhandler = require(`${NEURANET_CONSTANTS.LIBDIR}/pluginhandler.js`);
const llmflowrunner = require(`${NEURANET_CONSTANTS.LIBDIR}/llmflowrunner.js`);
const langdetector = require(`${NEURANET_CONSTANTS.THIRDPARTYDIR}/langdetector.js`);
const asb_in_proc_listener = require(`${NEURANET_CONSTANTS.THIRDPARTYDIR}/asb/listeners/inproc_listener.js`);

const REASONS = llmflowrunner.REASONS;

let ASB_BOOTSTRAPPED = false; if (!ASB_BOOTSTRAPPED) {asb.bootstrap(true); ASB_BOOTSTRAPPED=true;}
let flows_running = [];

exports.answer = async (params) => {
    if (!flows_running.includes(params.aiappid)) {
        params.flow.listener.id = params.aiappid;   // add ID to the listener matching the app ID
        asb.addFlow(params.flow); flows_running.push(params.aiappid);
    }

    if (!(await llmchat.check_quota(params.id, params.org, params.aiappid))) {
		LOG.error(`Disallowing the LLM chat call, as the user ${params.id} is over their quota.`);
		return {reason: REASONS.LIMIT, ...CONSTANTS.FALSE_RESULT};
	}

    const {aiModelToUse, aiModelObject, aiKey, aiLibrary} = await llmchat.getAIModelAndObjectKeyAndLibrary(params.model, params.id, params.org, params.aiappid);
	if (!aiModelToUse) {LOG.error("Bad AI Library or model - "+aiModuleToUse); return {reason: REASONS.BAD_MODEL, ...CONSTANTS.FALSE_RESULT}}

    const {sessionID} = chatsession.getUsersChatSession(params.id, params.session_id);
    const finalSessionObject = await chatsession.getFinalSessionObject(params.id, params.session_id, aiModelObject, aiLibrary, 
        params.session||[{"role": aiModelObject.user_role, "content": params.query}]);

    const simplellmcall = prompt => simplellm.prompt_answer(prompt, params.id, params.org, params.aiappid, undefined, aiModelObject);
    const llmchatcall = async prompt => {
        const paramsChat = { id: params.id, org: params.org, maintain_session: true, session_id: sessionID, 
            model: aiModelObject, session: [{"role": aiModelObject.user_role, "content": prompt}],
            auto_chat_summary_enabled: params.auto_summary||false, raw_question: prompt, aiappid: params.aiappid };
	    const response = await llmchat.chat(paramsChat);
        return response?.response;
    }
    const llmdocchat = pluginhandler.getPlugin("llmdocchat");
    const filesAttached = await llmdocchat.getFilesForPrompt(params.files);
    const languageDetectedForQuestion =  langdetector.getISOLang(params.question||params.raw_question);

    // the thought is that the message.content passed to the ASB in-process contains everything needed for AI calls
    const messageContent = {id: params.id, session: finalSessionObject, aimodeltouse: aiModelToUse, 
        aimodelobject: aiModelObject, aikey: aiKey, ailibrary: aiLibrary, simplellmcall, llmchatcall,
        simplellm: simplellm, llmchat: llmchat, raw_question: params.raw_question, filesAttached, languageDetectedForQuestion};

    return new Promise(resolve => {
        asb_in_proc_listener.inject(params.aiappid, {messageContent, responseReceiver: response => {
            if (response && response.airesponse) {
                const airesponse = response.airesponse;
                chatsession.addToSession(params.raw_question||params.session.at(-1).content, 
                    airesponse, params.id, sessionID, aiModelObject.user_role, aiModelObject.assistant_role);
                resolve({response: airesponse, reason: REASONS.OK, ...CONSTANTS.TRUE_RESULT, session_id: sessionID});
            } else resolve({reason: REASONS.INTERNAL, ...CONSTANTS.FALSE_RESULT});
        }})
    });
}