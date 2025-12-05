/** 
 * View main module for the Enterprise assistant view.
 * 
 * (C) 2023 Tekmonks Corp.
 */

import {i18n} from "/framework/js/i18n.mjs";
import {util} from "/framework/js/util.mjs";
import {router} from "/framework/js/router.mjs";
import {session} from "/framework/js/session.mjs";
import {apimanager as apiman} from "/framework/js/apimanager.mjs";

const MODULE_PATH = util.getModulePathFromURL(import.meta.url);
const API_SSE_EVENTS = "sseevents", NN_FILEUPDATE_EVENT_NAME = "nnfileupdate", NN_THOUGHTS_EVENT_NAME = "thoughts";

let chatsessionID, notification_events, old_thoughts={}, thoughtSubscribers=[], VIEW_PATH, AI_ENDPOINT;

function initView(data) {
    const loginresponse = session.get(APP_CONSTANTS.LOGIN_RESPONSE);    
    LOG.info(`The login response object is ${JSON.stringify(loginresponse)}`);
    window.monkshu_env.apps[APP_CONSTANTS.APP_NAME] = {
        ...(window.monkshu_env.apps[APP_CONSTANTS.APP_NAME]||{}), enterprise_assist_main: main}; 
    data.VIEW_PATH = data.viewpath;
    VIEW_PATH = data.viewpath;
    AI_ENDPOINT = data.aiendpoint;
    data.shownotifications = {action: "monkshu_env.apps[APP_CONSTANTS.APP_NAME].enterprise_assist_main.getNotifications()"};
    data.icons_refresh = `${MODULE_PATH}/../img/newchat`;
    data.tts_flag = data.activeaiapp.interface.tts == true ? "true" : "false";
    data.stt_flag = data.activeaiapp.interface.stt == true ? "true" : "false";
    setupSSEEvents();
}

async function getNotifications() {
    if (!notification_events) LOG.debug(`No notification events.`); 

    const eventsArray = []; if (notification_events) for (const event of Object.values(notification_events.events)) 
        eventsArray.push({...event, success: event.result == true ? true : undefined, 
            error: event.result == true ? undefined : true, VIEW_PATH});
    
    const eventsTemplate = document.querySelector("#notificationstemplate"), eventsHTML = eventsTemplate.innerHTML,
        matches = /<!--([\s\S]+)-->/g.exec(eventsHTML), template = matches[1]; 
    const renderedEvents = (await router.getMustache()).render(template, await router.getPageData(undefined, 
        {events:eventsArray.length?eventsArray:undefined})); 
    return renderedEvents;
}

async function getAssistantResult(question, files, message_id, chatbox, aiappid) {
    const request = {id: session.get(APP_CONSTANTS.USERID).toString(), org: session.get(APP_CONSTANTS.USERORG).toString(), 
        question, session_id: chatsessionID, aiappid, files, message_id};
    thoughtSubscribers[message_id] = async thoughts =>  // update chat with thoughts of the model while producing the final response
        chatbox.insertAIThoughts(thoughts.join("\n\n"), "text/markdown", message_id);
    const result = await apiman.rest(`${APP_CONSTANTS.API_PATH}/${AI_ENDPOINT}`, "POST", request, true);
    if (result.session_id) chatsessionID = result.session_id;  // save session ID so that backend can maintain session

    // handle all errors here and return early
    const doErrorResult = async err => chatbox.insertAIResponse({error: err||(await i18n.get("EnterpriseAssist_AIError")), ok: false, mime: "text/markdown"});
    if (!result) {doErrorResult(); return} // error, return
    if ((!result.result) && (result.reason == "limit")) {doErrorResult(await i18n.get("ErrorConvertingAIQuotaLimit")); return}
    // in case of no knowledge, allow the assistant to continue still, with the message that we have no knowledge to answer this particular prompt
    if ((!result.result) && (result.reason == "noknowledge")) {doErrorResult(await i18n.get("EnterpriseAssist_ErrorNoKnowledge")); return} 
    // bad result means chat failed
    if (!result.result) {doErrorResult(await i18n.get("ChatAIError")); return} 
    // result ok but no metadata means response is not from our data, reject it as well with no knowledge
    if (!result.metadatas) {doErrorResult(await i18n.get("EnterpriseAssist_ErrorNoKnowledge")); return} 

    // coming here means we have a good response with no errors
    const references=[]; for (const metadata of result.metadatas) if (!references.includes(
        decodeURIComponent(metadata.referencelink))) references.push(decodeURIComponent(metadata.referencelink));
    let resultRendered = (await router.getMustache()).render(await i18n.get("EnterpriseAssist_ResponseTemplate"), 
        {response: result.response, references});
    // add collapsible section for internal code etc
    if (result.jsonResponse && result.jsonResponse.analysis_code) {
        const collapsibleSection = chatbox.getCollapsibleSection(await i18n.get("EnterpriseAssistAnalysisLabel"), 
            `\`\`\`${result.jsonResponse.code_language.toLowerCase()}\n${result.jsonResponse.analysis_code}\n\`\`\`\n`);
        resultRendered = collapsibleSection + resultRendered;  
    }

    chatbox.insertAIResponse({ok: true, response: resultRendered, mime: "text/markdown"}, message_id);
    setTimeout(_=>delete thoughtSubscribers[message_id], 1000);  // response is final, thoughts can't be updated anymore
}

function setupSSEEvents() {
    const id = session.get(APP_CONSTANTS.USERID).toString(), org = session.get(APP_CONSTANTS.USERORG).toString();
    const sseURL = `${APP_CONSTANTS.API_PATH}/${API_SSE_EVENTS}`;
    const sse = apiman.subscribeSSEEvents(sseURL, {id, org}, true);
    sse.addEventListener(NN_FILEUPDATE_EVENT_NAME, event => {
        try {notification_events = JSON.parse(event.data)} catch (err) {LOG.error(`Error parsing file events`);}
    });
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

export const main = {initView, getNotifications, getAssistantResult};
