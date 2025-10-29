/**
 * AI based embedding generator.
 * 
 * Output is 
 * {embedding: The vector, error: null on success or error reason on error, reason: OK, or other reasons on failure}
 * 
 * The default model is embedding-openai.
 *  
 * (C) 2023 TekMonks. All rights reserved.
 */
const crypt = require(`${CONSTANTS.LIBDIR}/crypt.js`);
const quota = require(`${NEURANET_CONSTANTS.LIBDIR}/quota.js`);
const aiapp = require(`${NEURANET_CONSTANTS.LIBDIR}/aiapp.js`);
const dblayer = require(`${NEURANET_CONSTANTS.LIBDIR}/dblayer.js`);

const MODEL_DEFAULT = "embedding-openai", EMBEDDING_PROMPT = `${NEURANET_CONSTANTS.TRAININGPROMPTSDIR}/embedding_prompt.txt`,
    REASONS = {INTERNAL: "internal", BAD_MODEL: "badmodel", OK: "ok", LIMIT: "limit"}

async function createEmbeddingVector(id, org, aiappid, text, model) {
	LOG.debug(`Create embedding called for text ${text}`);
	
	const aiappThis = await aiapp.getAIApp(id, org, aiappid, true);
    if ((!aiappThis.disable_quota_checks) && (!(await quota.checkQuota(id, org, aiappid)))) {
		LOG.error(`Disallowing the embedding call, as the user ${id} is over their quota.`);
		return {reason: REASONS.LIMIT, error: "User is over quota limit."};
	}

    const aiModelToUse = model || MODEL_DEFAULT, 
		aiModelObject = typeof aiModelToUse === "object" ? aiModelToUse : await aiapp.getAIModel(aiModelToUse, undefined, id, org, aiappid),
        aiKey = crypt.decrypt(aiModelObject.ai_key, NEURANET_CONSTANTS.CONF.crypt_key),
		aiModuleToUse = `${NEURANET_CONSTANTS.LIBDIR}/${aiModelObject.driver.module}`;
	let aiLibrary; try{aiLibrary = require(aiModuleToUse);} catch (err) {
		LOG.error("Bad AI Library or model - "+aiModuleToUse); 
		return {reason: REASONS.BAD_MODEL, error: err};
	}
	
	const response = await aiLibrary.process({text}, EMBEDDING_PROMPT, aiKey, aiModelObject, false, true);

	if (!response) {
		LOG.error(`AI library error processing request for embedding ${text}`); 
		return {reason: REASONS.INTERNAL, error: "AI library error."};
	} else {
		LOG.info(`Vector successfully generated for text ${text}`); 
        if (!aiappThis.disable_model_usage_logging) dblayer.logUsage(id, response.metric_cost||0, aiModelObject.name);
		else LOG.info(`ID ${id} of org ${org} used ${response.metric_cost||0} of AI quota. Not logged, as usage logging is disabled by app ${aiappid}`);
		return {reason: REASONS.OK, embedding: response.airesponse};
	}
}

module.exports = {createEmbeddingVector, REASONS};