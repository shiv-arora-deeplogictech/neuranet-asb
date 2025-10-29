/**
 * A simple module to send a templated or a raw prompt, inflated with data, to any AI LLM
 * and then return the answer back.
 * 
 * (C) 2023 TekMonks. All rights reserved.
 * License: See the enclosed LICENSE file.
 */

const mustache = require("mustache");
const utils = require(`${CONSTANTS.LIBDIR}/utils.js`);
const crypt = require(`${CONSTANTS.LIBDIR}/crypt.js`);
const quota = require(`${NEURANET_CONSTANTS.LIBDIR}/quota.js`);
const aiapp = require(`${NEURANET_CONSTANTS.LIBDIR}/aiapp.js`);
const dblayer = require(`${NEURANET_CONSTANTS.LIBDIR}/dblayer.js`);
const aiutils = require(`${NEURANET_CONSTANTS.LIBDIR}/aiutils.js`);

const DEFAULT_SIMPLE_QA_MODEL = "simplellm-openai", DEBUG_MODE = NEURANET_CONSTANTS.CONF.debug_mode;

/**
 * Sends the given prompt to the indicated LLM and returns its raw response.
 * @param {string} promptFileOrPrompt Path to a prompt file or the full prompt itself if no data is provided to inflate the prompt.
 * @param {string} id The user ID on behalf of whom we are processing this request. If not given then LLM costs can't be updated.
 * @param {string} org The calling user's org
 * @param {string} aiappid The calling user's AI app
 * @param {object} data The prompt template data. If null then it is assume the promptFileOrPrompt is a full prompt.
 * @param {string} modelNameOrModelObject The LLM model name to use or object itseelf. If not provided then a default is used.
 * @returns The LLM response, unparsed.
 */
exports.prompt_answer = async function(promptFileOrPrompt, id, org, aiappid, data, modelNameOrModelObject=DEFAULT_SIMPLE_QA_MODEL) {
    const aiappThis = id ? await aiapp.getAIApp(id, org, aiappid, true) : undefined;
    if (id && (!aiappThis.disable_quota_checks) && !(await quota.checkQuota(id, org, aiappid))) {  // check quota if the ID was provided
		LOG.error(`SimpleLLM: Disallowing the LLM call, as the user ${id} is over their quota.`);
		return null;    // quota issue
	}

    const aiModelObject = typeof modelNameOrModelObject === "string" ? 
        await aiapp.getAIModel(modelNameOrModelObject, undefined, id, org, aiappid) : modelNameOrModelObject,
        aiKey = crypt.decrypt(aiModelObject.ai_key, NEURANET_CONSTANTS.CONF.crypt_key),
        aiModuleToUse = `${NEURANET_CONSTANTS.LIBDIR}/${aiModelObject.driver.module}`;

    let aiLibrary; try{aiLibrary = utils.requireWithDebug(aiModuleToUse, DEBUG_MODE);} catch (err) {
        LOG.error(`SimpleLLM: Bad AI Library or model - ${aiModuleToUse}.`); 
        return null;    // bad AI library or model
    }

    const rawPrompt = typeof promptFileOrPrompt === "string" ? promptFileOrPrompt : await aiutils.getPrompt(promptFileOrPrompt);
    const prompt = (data?mustache.render(rawPrompt, data):rawPrompt).replace(/\r\n/gm,"\n");
    const promptJSONForAILib = JSON.stringify([{role: aiModelObject.system_role, 
        content: aiModelObject.system_message}, {role: aiModelObject.user_role, content: prompt}]);

    const response = await aiLibrary.process(null, promptJSONForAILib, aiKey, aiModelObject, true);
    if (!response) {
        LOG.error(`SimpleLLM: LLM API library returned error (null reponse) for the prompt ${prompt}.`); 
        return null; // LLM call error
    }

    if (id && (!aiappThis.disable_model_usage_logging)) dblayer.logUsage(id, response.metric_cost||0, aiModelObject.name);
    else LOG.info(`ID ${id} of org ${org} used ${response.metric_cost||0} of AI quota. Not logged, as usage logging is disabled by app ${aiappid}`);
    return response.airesponse;
}
