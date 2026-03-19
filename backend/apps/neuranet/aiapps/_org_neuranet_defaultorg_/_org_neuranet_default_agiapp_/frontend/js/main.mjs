/** 
 * View main module for the Custom Enterprise assistant view.
 * This is frontend code as it actually runs under the Neuranet 
 * frontend once the app is published.
 * 
 * (C) 2023 Tekmonks Corp.
 */

import {i18n} from "/framework/js/i18n.mjs";
import {util} from "/framework/js/util.mjs";
import {router} from "/framework/js/router.mjs";
import {session} from "/framework/js/session.mjs";
import {apimanager as apiman} from "/framework/js/apimanager.mjs";

const API_SSE_EVENTS = "sseevents", NN_THOUGHTS_EVENT_NAME = "thoughts";

let chatsessionID, old_thoughts={}, thoughtSubscribers=[], VIEW_PATH, AI_ENDPOINT, mustache;

async function initView(data) {
    mustache = await router.getMustache();
    window.monkshu_env.apps[APP_CONSTANTS.APP_NAME] = {
        ...(window.monkshu_env.apps[APP_CONSTANTS.APP_NAME]||{}), custom_enterprise_assist_main: main}; 
    data.VIEW_PATH = data.viewpath;
    VIEW_PATH = data.viewpath;
    AI_ENDPOINT = data.aiendpoint;
    i18n.addPath(`${VIEW_PATH}`);
    
    const starterPrompts = (await i18n.get("CustomEnterpriseAssist_StarterPrompts")).split("|").map(value=>value.trim());
    const randomPrompt = starterPrompts[Math.floor(Math.random()*starterPrompts.length)];
    const userfname = session.get(APP_CONSTANTS.USERNAME).toString().split(" ")[0];
    data.greeting = mustache.render(randomPrompt, {name: userfname});  // random greeting
    
    _setupSSEEvents();
}


async function getAssistantResult(question, files, message_id, chatbox, aiappid, useSSE) {
    const request = {id: session.get(APP_CONSTANTS.USERID).toString(), org: session.get(APP_CONSTANTS.USERORG).toString(),
        question, session_id: chatsessionID, aiappid, files, message_id, jobrequest: useSSE};
    thoughtSubscribers[message_id] = async thoughts =>  // update chat with thoughts of the model while producing the final response
        chatbox.insertAIThoughts(thoughts.join("\n\n"), "text/markdown", message_id);
    const result = await apiman.rest({url: `${APP_CONSTANTS.API_PATH}/${AI_ENDPOINT}`, type: "POST",
        req: request, sendToken: true, sseURL: useSSE ? `${APP_CONSTANTS.API_PATH}/${API_SSE_EVENTS}` : false});
    if (result?.session_id) chatsessionID = result.session_id;  // save session ID so that backend can maintain session

    // handle all errors here and return early
    const doErrorResult = async err => chatbox.insertAIResponse({error: err||(await i18n.get("CustomEnterpriseAssist_AIError")), ok: false, mime: "text/markdown"});
    if (!result) {doErrorResult(); return} // error, return
    if ((!result.result) && (result.reason == "limit")) {doErrorResult(await i18n.get("ErrorConvertingAIQuotaLimit")); return}
    // in case of no knowledge, allow the assistant to continue still, with the message that we have no knowledge to answer this particular prompt
    if ((!result.result) && (result.reason == "noknowledge")) {chatbox.insertAIResponse({ok: true, response: await i18n.get("CustomEnterpriseAssist_ErrorNoKnowledge"), mime: "text/markdown"}, message_id); return}
    // bad result means chat failed
    if (!result.result) {doErrorResult(await i18n.get("ChatAIError")); return} 
    // result ok but no metadata means response is not from our data, reject it as well with no knowledge
    if (!result.metadatas) {chatbox.insertAIResponse({ok: true, response: await i18n.get("CustomEnterpriseAssist_ErrorNoKnowledge"), mime: "text/markdown"}, message_id); return}

    // coming here means we have a good response with no errors
    const resultRendered = await parseAIResponse(result, chatbox);
    chatbox.insertAIResponse({ok: true, response: resultRendered, mime: "text/markdown"}, message_id);
    setTimeout(_=>delete thoughtSubscribers[message_id], 2000);  // response is final, thoughts can't be updated anymore
}

async function parseAIResponse(ai_result, chatbox) {
    if (!ai_result.jsonResponse) ai_result.jsonResponse = {response: ai_result.response};  // handle simple results here

    const references=[]; for (const metadata of (ai_result.metadatas||[])) if (!references.includes(
          decodeURIComponent(metadata.referencelink))) references.push(decodeURIComponent(metadata.referencelink));
    if (references.length) ai_result.jsonResponse.references = references;

    // render the text of the final response as MD
    let rendered = mustache.render(await i18n.get("CustomEnterpriseAssistResponseTemplate"), {
        response: ai_result.jsonResponse.response, references: ai_result.jsonResponse.references});

    if (ai_result.jsonResponse.analysis_code) {      // add collapsible section for internal code etc
        const collapsibleSection = chatbox.getCollapsibleSection(await i18n.get("CustomEnterpriseAssistAnalysisLabel"), 
            `\`\`\`${ai_result.jsonResponse.code_language.toLowerCase()}\n${ai_result.jsonResponse.analysis_code}\n\`\`\`\n`);
        rendered = collapsibleSection + rendered;  
    }

    return rendered;
}

function _setupSSEEvents() {
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
