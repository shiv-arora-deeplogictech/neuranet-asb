/**
 * Runs ASB flows and provides answers. Injects the message into ASB with this format
 * {question, raw_question, session, aimodeltouse, aimodelobject, aikey, ailibrary}
 * 
 * @param {Object} params Request params documented below
 * 	                          id - The user ID
 *                            org - User's Org
 *                            session_id - The session ID for a previous session if this is a continuation
 *                            message_id - The message ID
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

const yaml = require("yaml");
const fspromises = require("fs").promises;
const utils = require(`${CONSTANTS.LIBDIR}/utils.js`);
const aiapp = require(`${NEURANET_CONSTANTS.LIBDIR}/aiapp.js`);
const llmchat = require(`${NEURANET_CONSTANTS.LIBDIR}/llmchat.js`);
const sseevents = require(`${NEURANET_CONSTANTS.APIDIR}/sseevents.js`);
const simplellm = require(`${NEURANET_CONSTANTS.LIBDIR}/simplellm.js`);
const chatsession = require(`${NEURANET_CONSTANTS.LIBDIR}/chatsession.js`);
const asb = require(`${NEURANET_CONSTANTS.THIRDPARTYDIR}/asb/lib/main.js`);
const pluginhandler = require(`${NEURANET_CONSTANTS.LIBDIR}/pluginhandler.js`);
const llmflowrunner = require(`${NEURANET_CONSTANTS.LIBDIR}/llmflowrunner.js`);
const langdetector = require(`${NEURANET_CONSTANTS.THIRDPARTYDIR}/langdetector.js`);

const REASONS = llmflowrunner.REASONS, FILE_CACHE = {};

let ASB_BOOTSTRAPPED = false; if (!ASB_BOOTSTRAPPED) {asb.bootstrap(true); ASB_BOOTSTRAPPED=true;}
let flows_running = [];

exports.init = aiapp => {
    const aiappid = aiapp.id, asbflow = aiapp.llm_flow[0].in.asbflow;
    const inProcListener = _findInProcListener(asbflow);
    if (!flows_running.includes(aiappid)) {
        if (inProcListener) inProcListener.id = aiappid;   // add ID to the listener matching the app ID
        asb.addFlow(asbflow); flows_running.push(aiappid);
    }
}

exports.answer = async (params) => {
    const inProcListener = _findInProcListener(params.asbflow);
    if (!flows_running.includes(params.aiappid)) {
        if (inProcListener) inProcListener.id = params.aiappid;   // add ID to the listener matching the app ID
        asb.addFlow(params.asbflow); flows_running.push(params.aiappid);
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
            auto_chat_summary_enabled: params.auto_summary||false, raw_question: prompt, 
            aiappid: params.aiappid, message_id: params.message_id};
	    const response = await llmchat.chat(paramsChat);
        return response?.response;
    }
    const llmdocchat = pluginhandler.getPlugin("llmdocchat");
    const filesAttached = await llmdocchat.getFilesForPrompt(params.files);
    const languageDetectedForQuestion =  langdetector.getISOLang(params.question||params.raw_question);

    const promptsFile = `${aiapp.getAppDir(params.id, params.org, params.aiappid)}/prompts.yaml`;
    let prompts; try { prompts = FILE_CACHE[promptsFile] || ( (await utils.exists(promptsFile)) ? 
        yaml.parse(await fspromises.readFile(promptsFile, "utf-8")) : undefined ); }
    catch (err) { LOG.error(`Bad prompts file ${promptsFile} for org ${params.org} and aiapp ${params.aiappid}`); 
        return {reason: REASONS.INTERNAL, ...CONSTANTS.FALSE_RESULT}; }
    if ((!FILE_CACHE[promptsFile]) && prompts) FILE_CACHE[promptsFile] = prompts;   // file cache will be empty every run in debug mode as plugins are reloaded in debug mode in every run
    const getPrompt = key => prompts ? (prompts[`${key}_${languageDetectedForQuestion}`] || prompts[key]) : undefined;

    const emit_thought = thought => sseevents.emitThought(params.id, params.org, params.message_id, thought);
    const getPlugin = name => aiapp.getCommandModule(params.id, params.org, params.aiappid, name);

    // the thought is that the message.content passed to the ASB in-process contains everything needed 
    // for AI calls - to make the ASB nodes easier to code
    const messageContent = {...params, session_id: sessionID, filesAttached,
        lang: languageDetectedForQuestion, session: finalSessionObject, aimodeltouse: aiModelToUse, 
        aimodelobject: aiModelObject, aikey: aiKey, ailibrary: aiLibrary, simplellmcall, llmchatcall, 
        simplellm, llmchat, emit_thought, prompts, getPrompt, getPlugin};

    if (inProcListener) return new Promise(resolve => {
        inProcListener.inject(params.aiappid, {messageContent, responseReceiver: response => {
            if (response && response.airesponse) {
                const airesponse = response.airesponse;
                resolve(airesponse);
            } else resolve({reason: REASONS.INTERNAL, ...CONSTANTS.FALSE_RESULT});
        }})
    }); else return({reason: REASONS.NOTCHATAI, ...CONSTANTS.FALSE_RESULT}); // else this is not a chatting AI
}

function _findInProcListener(flowNodes) {
    for (const nodename of Object.keys(flowNodes))  if (flowNodes[nodename].type == "inproc_listener") return flowNodes[nodename];
}