/** 
 * View main module for the ai workshop view.
 * 
 * (C) 2023 Tekmonks Corp.
 */

import {util} from "/framework/js/util.mjs";
import {i18n} from "/framework/js/i18n.mjs";
import {router} from "/framework/js/router.mjs";
import {session} from "/framework/js/session.mjs";
import {apimanager as apiman} from "/framework/js/apimanager.mjs";

const MODULE_PATH = util.getModulePathFromURL(import.meta.url), VIEW_PATH = util.resolveURL(`${MODULE_PATH}/../`);
const API_GET_AIAPPS = "getorgaiapps", API_OPERATEAIAPP = "operateaiapp";
const DIALOG_ID = "dialog";

let selectedAIAppID, allAIApps, neuranetapp, cached_templates;

async function initView(data, neuranetappIn) {
    neuranetapp = neuranetappIn;
    window.monkshu_env.apps[APP_CONSTANTS.APP_NAME] = {
        ...(window.monkshu_env.apps[APP_CONSTANTS.APP_NAME]||{}), aiworkshop_main: main}; 
        
    data.VIEW_PATH = VIEW_PATH;
    const id = session.get(APP_CONSTANTS.USERID).toString(), org = session.get(APP_CONSTANTS.USERORG).toString();
    const aiAppsResult = await apiman.rest(`${APP_CONSTANTS.API_PATH}/${API_GET_AIAPPS}`, "GET", {id, org, unpublished: true}, true);
    if(!data.admin){
        data.aiapps = aiAppsResult.result ? aiAppsResult.aiapps.filter(item => item.admins.includes(id) || item.admins.includes("*")) : [];
    } else {
        data.aiapps = aiAppsResult.result ? aiAppsResult.aiapps : [];
    }
    const skippable_file_patternsSet = aiAppsResult.aiapps.find(item => Array.isArray(item.interface.skippable_file_patterns));
    const skippable_file_patterns = skippable_file_patternsSet ? skippable_file_patternsSet.interface.skippable_file_patterns : [];
    data.aiskipfolders_base64_json = skippable_file_patterns ? util.stringToBase64(JSON.stringify(skippable_file_patterns)) : undefined;
    allAIApps = data.aiapps;
}

async function aiappSelected(divAIApp, aiappid) {
    const fileManager = document.querySelector("file-manager#fmaiapp"); divAIApp.classList.toggle('selected'); 
    const titleSpan = document.querySelector("span#title");
    

    if (!divAIApp.classList.contains('selected')) {  // was deselected, nothing open
        fileManager.classList.remove("visible"); selectedAIAppID = undefined; 
        titleSpan.innerHTML = await i18n.get("AIWorkshop_Title");
    } else {
        titleSpan.innerHTML = `${await i18n.get("AIWorkshop_Title")} - ${(await router.getMustache()).render(
            await i18n.get("AIWorkshop_Subtitle_EditApp"), {aiappid})}`;
        for (const divAIApp of document.querySelectorAll("div.aiappicon")) divAIApp.classList.remove("selected");
        divAIApp.classList.add('selected'); // coming here means it was selected

        // now point the file selector's CMS root to this app
        const extrainfo = {id: session.get(APP_CONSTANTS.USERID).toString(), 
                org: session.get(APP_CONSTANTS.USERORG).toString(), aiappid, mode: "editaiapp"};
        const extrainfo_base64_json = util.stringToBase64(JSON.stringify(extrainfo));
        fileManager.setAttribute("extrainfo", extrainfo_base64_json);
        fileManager.classList.add("visible"); monkshu_env.components["file-manager"].reload("fmaiapp");

        // flag the selected AI application for future functions on it
        selectedAIAppID = aiappid;
    }
}

async function newAIApp() {
    const loginresponse = session.get(APP_CONSTANTS.LOGIN_RESPONSE);
    if (loginresponse.role==="admin") {
        const id = session.get(APP_CONSTANTS.USERID).toString(), org = session.get(APP_CONSTANTS.USERORG).toString();
        const templates = cached_templates || (await apiman.rest(
            `${APP_CONSTANTS.API_PATH}/${API_OPERATEAIAPP}`, "POST", {id, org, op: "listtemplates"}, true)).templates || [];
        if (!cached_templates) cached_templates = templates;
        const newApp = await _prompt(`${VIEW_PATH}/dialogs/prompt.html`, 
            {prompt: await i18n.get("AIWorkshop_AIAppNamePrompt"), templates, 
            templatelabel: await i18n.get("AIWorkshop_TemplateLabel")}, ["name", "template"]);
        const appName = newApp.name, appTemplate = newApp.template;
        if (!(appName?.trim())) return;   // nothing to do
        if (allAIApps.some(value => value.id.toLowerCase() == appName.toLowerCase())) {    // app already exists, don't overwrite
            _showError(await i18n.get("AIWorkshop_AIAppAlreadyExists"));
            return;
        }

        const result = await apiman.rest(`${APP_CONSTANTS.API_PATH}/${API_OPERATEAIAPP}`, "POST", 
            {id, org, aiappid: appName, template: appTemplate, op: "new"}, true);
        if (result && result.result) {await neuranetapp.refreshAIApps(); router.reload();}
        else _showError(await i18n.get("AIWorkshop_AIAppGenericError"));
    } else await _showError(await i18n.get("AIWorkshop_NotAdmin"));
}

async function deleteAIApp() {
    if (!selectedAIAppID) return; // nothing to do.
    const id = session.get(APP_CONSTANTS.USERID).toString(), org = session.get(APP_CONSTANTS.USERORG).toString();
    const result = await apiman.rest(`${APP_CONSTANTS.API_PATH}/${API_OPERATEAIAPP}`, "POST", 
        {id, org, aiappid: selectedAIAppID, op: "delete"}, true);
    if (result && result.result) {await neuranetapp.refreshAIApps(); router.reload();}
    else _showError(await i18n.get("AIWorkshop_AIAppGenericError"));
}

async function publishAIApp() {
    if (!selectedAIAppID) return; // nothing to do.
    const id = session.get(APP_CONSTANTS.USERID).toString(), org = session.get(APP_CONSTANTS.USERORG).toString();
    const result = await apiman.rest(`${APP_CONSTANTS.API_PATH}/${API_OPERATEAIAPP}`, "POST", 
        {id, org, aiappid: selectedAIAppID, op: "publish"}, true);
    if (result && result.result) {await neuranetapp.refreshAIApps(); _showMessage(await i18n.get("AIWorkshop_AIAppGenericSuccess"));}
    else _showError(await i18n.get("AIWorkshop_AIAppGenericError"));
}

async function unpublishAIApp() {
    if (!selectedAIAppID) return; // nothing to do.
    const id = session.get(APP_CONSTANTS.USERID).toString(), org = session.get(APP_CONSTANTS.USERORG).toString();
    const result = await apiman.rest(`${APP_CONSTANTS.API_PATH}/${API_OPERATEAIAPP}`, "POST", 
        {id, org, aiappid: selectedAIAppID, op: "unpublish"}, true);
    if (result && result.result) {await neuranetapp.refreshAIApps(); _showMessage(await i18n.get("AIWorkshop_AIAppGenericSuccess"));}
    else _showError(await i18n.get("AIWorkshop_AIAppGenericError"));
}

async function trainAIApp() {
    if (!selectedAIAppID) return;  // nothing selected

    const fileManager = document.querySelector("file-manager#fmaiapp"); 
    const titleSpan = document.querySelector("span#title");
    titleSpan.innerHTML = `${await i18n.get("AIWorkshop_Title")} - ${(await router.getMustache()).render(
        await i18n.get("AIWorkshop_Subtitle_TrainApp"), {aiappid: selectedAIAppID})}`;

    // now point the file selector's CMS root to this app
    const extrainfo = {id: session.get(APP_CONSTANTS.USERID).toString(), 
            org: session.get(APP_CONSTANTS.USERORG).toString(), aiappid: selectedAIAppID, mode: "trainaiapp"};
    const extrainfo_base64_json = util.stringToBase64(JSON.stringify(extrainfo));
    fileManager.setAttribute("extrainfo", extrainfo_base64_json);
    monkshu_env.components["file-manager"].reload("fmaiapp");
}

const close = _ => neuranetapp.closeview();

async function _prompt(prompthtml, data, outputs) {
    const answer = await monkshu_env.components["dialog-box"].showDialog(prompthtml, true, true, data, DIALOG_ID, outputs);
    monkshu_env.components["dialog-box"].hideDialog(DIALOG_ID);
    const retObject = {}; for (const output of outputs) retObject[output] = answer[output];
    return retObject;
}

const _showMessage = (message) => monkshu_env.components["dialog-box"].showMessage(message, DIALOG_ID);
const _showError = (error) => _showMessage(error);

export const main = {initView, aiappSelected, newAIApp, deleteAIApp, publishAIApp, unpublishAIApp, trainAIApp, close};