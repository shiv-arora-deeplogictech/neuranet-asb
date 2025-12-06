/** 
 * View main module for the chat view.
 * 
 * (C) 2023 Tekmonks Corp.
 */

import {i18n} from "/framework/js/i18n.mjs";
import {util} from "/framework/js/util.mjs";
import {session} from "/framework/js/session.mjs";
import {apimanager as apiman} from "/framework/js/apimanager.mjs";
const responseparser = (await import (`${APP_CONSTANTS.LIB_PATH}/responseparser.mjs`)).responseparser;

const MODULE_PATH = util.getModulePathFromURL(import.meta.url);
const API_SSE_EVENTS = "sseevents", NN_THOUGHTS_EVENT_NAME = "thoughts";

let chatsessionID, old_thoughts={}, thoughtSubscribers=[], AI_ENDPOINT;

function initView(data) {
    window.monkshu_env.apps[APP_CONSTANTS.APP_NAME] = {
        ...(window.monkshu_env.apps[APP_CONSTANTS.APP_NAME]||{}), chat_main: main}; 
    data.icons_refresh = `${MODULE_PATH}/../img/newchat`;
    AI_ENDPOINT = data.aiendpoint;
    data.tts_flag = data.activeaiapp.interface.tts == true ? "true" : "false";
    data.stt_flag = data.activeaiapp.interface.stt == true ? "true" : "false";
    data.typewriter = data.activeaiapp.interface.typewriter ? data.activeaiapp.interface.typewriter : "false";
    setupSSEEvents();
}

async function getAssistantResult(question, files, message_id, chatbox, aiappid) {
    const request = {id: session.get(APP_CONSTANTS.USERID).toString(), org: session.get(APP_CONSTANTS.USERORG).toString(), 
        question, session_id: chatsessionID, aiappid, files, message_id};
    thoughtSubscribers[message_id] = async thoughts =>  // update chat with thoughts of the model while producing the final response
        chatbox.insertAIThoughts(thoughts.join("\n\n"), "text/markdown", message_id);
    const result = await apiman.rest(`${APP_CONSTANTS.API_PATH}/${AI_ENDPOINT}`, "POST", request, true);
    if (result.session_id) chatsessionID = result.session_id;  // save session ID so that backend can maintain session

    // handle all errors here and return early
    const doErrorResult = async err => chatbox.insertAIResponse({error: err||(await i18n.get("ChatAIError")), ok: false, mime: "text/markdown"});
    if (!result?.result) {
        doErrorResult(result?.reason == "limit"?await i18n.get("ErrorConvertingAIQuotaLimit"):undefined); 
        return;
    } 

    // coming here means we have a good response with no errors
    const resultRendered = await responseparser.parseAIResponse(result, chatbox); 
    chatbox.insertAIResponse({ok: true, response: resultRendered, mime: "text/markdown"}, message_id);
    setTimeout(_=>delete thoughtSubscribers[message_id], 2000);  // response is final, thoughts can't be updated anymore
}

function setupSSEEvents() {
    const id = session.get(APP_CONSTANTS.USERID).toString(), org = session.get(APP_CONSTANTS.USERORG).toString();
    const sseURL = `${APP_CONSTANTS.API_PATH}/${API_SSE_EVENTS}`;
    const sse = apiman.subscribeSSEEvents(sseURL, {id, org}, true);
    sse.addEventListener(NN_THOUGHTS_EVENT_NAME, event => {
        try {
            const thought_events = JSON.parse(event.data).events;
            if (!util.areObjectsEqual(old_thoughts, thought_events)) {
                _newThoughtsDetected(old_thoughts, thought_events);
                old_thoughts = thought_events;
            }
        } catch (err) {LOG.error(`Error parsing thought events, skipping this SSE update.`);}
    });
}

function _newThoughtsDetected(oldThoughts, newThoughts) {
    for (const [message_id, thoughts] of Object.entries(newThoughts))
        if (oldThoughts[message_id]?.sort().join(",") != thoughts.sort().join(",")) // this checks members are equal in the two arrays
            if (thoughtSubscribers[message_id]) thoughtSubscribers[message_id](thoughts);
}

export const main = {initView, getAssistantResult};