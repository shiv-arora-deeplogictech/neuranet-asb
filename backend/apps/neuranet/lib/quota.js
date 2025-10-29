/**
 * Quota calculations.
 * (C) 2022 TekMonks. All rights reserved.
 * See enclosed LICENSE file.
 */

const aiapp = require(`${NEURANET_CONSTANTS.LIBDIR}/aiapp.js`);
const dblayer = require(`${NEURANET_CONSTANTS.LIBDIR}/dblayer.js`);

const DEFAULT_QUOTA = 0.6;

exports.checkQuota = async function(id, org, aiappid) {
    LOG.info(`Quota check called for ID ${id} from org ${org}.`);
    const aiappThis = aiappid ? await aiapp.getAIApp(id, org, aiappid, true) : undefined;
    if (aiappThis?.disable_quota_checks) {LOG.info(`Quota check disabled by app ${aiappid} for ${id}, not checking or enforcing.`); return true;}    // quota checks are disabled

    let allowedQuota = aiappid ? aiappThis.ai_cost_quota || NEURANET_CONSTANTS.CONF.default_ai_cost_quota || DEFAULT_QUOTA : 
        NEURANET_CONSTANTS.CONF.default_ai_cost_quota || DEFAULT_QUOTA;

    if (allowedQuota == -1) {LOG.warn(`No quota found for ID ${id}, not checking or enforcing.`); return true;}
    LOG.debug(`Found that ID ${id} from org ${org} is allowed a quota price equal to ${allowedQuota}.`);

    const models = Object.keys(NEURANET_CONSTANTS.CONF.ai_models), 
        unixepochNow = Math.floor(new Date().getTime() / 1000), SECONDS_IN_24_HOURS = 86400;
    let totalUsedIn24Hours = 0; for (const model of models) {
        try {
            const modelUsage = await dblayer.getAIModelUsage(id, unixepochNow - SECONDS_IN_24_HOURS, unixepochNow, model),
                priceOfUsageThisModel = modelUsage * NEURANET_CONSTANTS.CONF.ai_models[model].price_per_unit;
            totalUsedIn24Hours += priceOfUsageThisModel;
            LOG.debug(`ID ${id} from org ${org} used ${modelUsage} units of model ${model} in the last 24 hours, which equates to a price of ${priceOfUsageThisModel}.`);
        } catch (err) {
            LOG.error(`Bad model definition - ${model}`); throw err;
        }
    }

    if (totalUsedIn24Hours > allowedQuota) {
        LOG.error(`Quota overuse for ID ${id} from org ${org}, allowed = ${allowedQuota}, used = ${totalUsedIn24Hours}.`);
        return false; 
    } else {
        LOG.info(`Quota underuse for ID ${id} from org ${org}, allowed = ${allowedQuota}, used = ${totalUsedIn24Hours}, allowing.`);
        return true;
    }
}