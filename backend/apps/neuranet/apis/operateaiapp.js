/**
 * Operates on an org's AI apps. The caller must be an org 
 * admin.
 * 
 * API Request
 * 	org - the user's org (security is JWT enforced)
 *  aiappid - the AI app ID
 *  frontend_relative_webroot - the app's webroot relative to the frontend (needed for publish, delete and unpublish)
 *  op can be
 *    - listemplates sends back list of available templates for new apps {templates: [{id, label}]}
 *    - new (creates a new AI app by using default one as a template)
 *    - publish publishes the given AI app
 *    - unpublish unpublishes the given AI app
 *    - delete deletes the given AI app
 * 
 * API Response
 *  result - true or false
 * 
 * (C) 2023 TekMonks. All rights reserved.
 * License: See the enclosed LICENSE file.
 */

const aiapp = require(`${NEURANET_CONSTANTS.LIBDIR}/aiapp.js`);

const OPS = Object.freeze({LIST_TEMPLATES: "listtemplates", NEW: "new", DELETE: "delete", PUBLISH: "publish", UNPUBLISH: "unpublish"})

exports.doService = async jsonReq => {
    if (!validateRequest(jsonReq)) {LOG.error("Validation failure."); return CONSTANTS.FALSE_RESULT};
    const op = jsonReq.op.toLowerCase(), id = jsonReq.id, org = jsonReq.org.toLowerCase();
    const frontend_relative_webroot = jsonReq.frontend_relative_webroot;
    const aiappid = jsonReq.aiappid ? jsonReq.aiappid.toLowerCase().trim().replaceAll(" ", "_") : undefined; // ensuring that aiappid must not have spaces
    const aiapplabel = jsonReq.aiapplabel || NEURANET_CONSTANTS.DEFAULT_AIAPP_LABEL;
    const template = jsonReq.template;

    if (op == OPS.LIST_TEMPLATES) return {...CONSTANTS.TRUE_RESULT, templates: await aiapp.getAppTemplates()};
    else if (op == OPS.NEW) return {result: await aiapp.initNewAIAppForOrg(aiappid, aiapplabel, id, org, template)};
    else if (op == OPS.DELETE) return {result: await aiapp.deleteAIAppForOrg(aiappid, id, org, frontend_relative_webroot)};
    else if (op == OPS.PUBLISH) return {result: await aiapp.publishAIAppForOrg(aiappid, id, org, frontend_relative_webroot)};
    else if (op == OPS.UNPUBLISH) return {result: await aiapp.unpublishAIAppForOrg(aiappid, id, org, frontend_relative_webroot)};
    else {LOG.error(`Unknown op ${op} for AI app ${aiappid}`); return CONSTANTS.FALSE_RESULT;}
}

exports.OPS = OPS;

const validateRequest = jsonReq => (jsonReq.op==OPS.LIST_TEMPLATES || jsonReq.aiappid) && jsonReq.id && 
    jsonReq.org && jsonReq.op && 
    ((jsonReq.op != OPS.DELETE && jsonReq.op != OPS.PUBLISH && jsonReq.op != OPS.UNPUBLISH) || jsonReq.frontend_relative_webroot);