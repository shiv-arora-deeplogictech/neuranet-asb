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
const API_SSE_EVENTS = "sseevents", NN_FILEUPDATE_EVENT_NAME = "nnfileupdate";

let chatsessionID, notification_events, VIEW_PATH;

function initView(data) {
    const loginresponse = session.get(APP_CONSTANTS.LOGIN_RESPONSE), 
        isAdmin = data.activeaiapp.is_user_appadmin||session.get(APP_CONSTANTS.CURRENT_USERROLE).toString() == "admin";
    LOG.info(`The login response object is ${JSON.stringify(loginresponse)}`);
    window.monkshu_env.apps[APP_CONSTANTS.APP_NAME] = {
        ...(window.monkshu_env.apps[APP_CONSTANTS.APP_NAME]||{}), enterprise_assist_main: main}; 
    data.VIEW_PATH = data.viewpath;
    VIEW_PATH = data.viewpath;
    data.show_ai_training = data.activeaiapp.interface.show_training_in_chat && isAdmin;
    data.collapse_ai_training = true;
    data.extrainfo = {id: session.get(APP_CONSTANTS.USERID).toString(), 
        org: session.get(APP_CONSTANTS.USERORG).toString(), aiappid: data.activeaiapp.id, mode: "trainaiapp"};
    data.extrainfo_base64_json = util.stringToBase64(JSON.stringify(data.extrainfo));
    data.shownotifications = {action: "monkshu_env.apps[APP_CONSTANTS.APP_NAME].enterprise_assist_main.getNotifications()"};
    data.aiskipfolders_base64_json = data.activeaiapp.interface.skippable_file_patterns?
        util.stringToBase64(JSON.stringify(data.activeaiapp.interface.skippable_file_patterns)) : undefined;
    data.icons_refresh = `${MODULE_PATH}/../img/newchat`;
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

async function processAssistantResponse(chatbox, result, chatboxid, _aiappid) {
    if (!result) return {error: (await i18n.get("EnterpriseAssist_AIError")), ok: false}
    if (result.session_id) chatsessionID = result.session_id;  // save session ID so that backend can maintain session
    if ((!result.result) && (result.reason == "limit")) return {error: await i18n.get("ErrorConvertingAIQuotaLimit"), ok: false};

    // in case of no knowledge, allow the assistant to continue still, with the message that we have no knowledge to answer this particular prompt
    if ((!result.result) && (result.reason == "noknowledge")) return {ok: true, response: await i18n.get("EnterpriseAssist_ErrorNoKnowledge")};
    // bad result means chat failed
    if (!result.result) return {error: await i18n.get("ChatAIError"), ok: false};
    // result ok but no metadata means response is not from our data, reject it as well with no knowledge
    if (!result.metadatas) return {ok: true, response: await i18n.get("EnterpriseAssist_ErrorNoKnowledge")};

    const references=[]; for (const metadata of result.metadatas) if (!references.includes(
        decodeURIComponent(metadata.referencelink))) references.push(decodeURIComponent(metadata.referencelink));
    let resultFinal = (await router.getMustache()).render(await i18n.get("EnterpriseAssist_ResponseTemplate"), 
        {response: result.response, references});
    if (result.jsonResponse && result.jsonResponse.analysis_code) {
        const collapsibleSection = chatbox.getCollapsibleSection(chatboxid, await i18n.get("EnterpriseAssistAnalysisLabel"), 
            `\`\`\`${result.jsonResponse.code_language.toLowerCase()}\n${result.jsonResponse.analysis_code}\n\`\`\`\n`);
        resultFinal = collapsibleSection + resultFinal;
    }

    return {ok: true, response: resultFinal};
}

const getAssistantRequest = (question, files, _chatboxid, aiappid) => {
    return {id: session.get(APP_CONSTANTS.USERID).toString(), org: session.get(APP_CONSTANTS.USERORG).toString(), 
        question, session_id: chatsessionID, aiappid, files};
}

function setupSSEEvents() {
    const id = session.get(APP_CONSTANTS.USERID).toString(), org = session.get(APP_CONSTANTS.USERORG).toString();
    const sseURL = `${APP_CONSTANTS.API_PATH}/${API_SSE_EVENTS}`;
    const sse = apiman.subscribeSSEEvents(sseURL, {id, org}, true);
    sse.addEventListener(NN_FILEUPDATE_EVENT_NAME, event => notification_events = JSON.parse(event.data));
}

export const main = {initView, getNotifications, processAssistantResponse, getAssistantRequest};
