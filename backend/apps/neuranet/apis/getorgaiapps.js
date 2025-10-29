/**
 * Returns the list of published and unpublished AI apps for an org.
 * 
 * API Request
 *  id - the user's ID
 * 	org - the user's org (security is JWT enforced)
 *  unpublished - Optional: return unpublished apps as well, if set to true
 * 
 * API Response
 *  result - true or false
 *  aiapps - array, contains the list of apps for the org
 * 
 * (C) 2023 TekMonks. All rights reserved.
 * License: See the enclosed LICENSE file.
 */

const aiapp = require(`${NEURANET_CONSTANTS.LIBDIR}/aiapp.js`);

exports.doService = async jsonReq => {
    if (!validateRequest(jsonReq)) {LOG.error("Validation failure."); return CONSTANTS.FALSE_RESULT};
    
    try {
        const aiapps = await aiapp.getAllAIAppsForOrg(jsonReq.id, jsonReq.org, jsonReq.unpublished?false:true);
        return {...CONSTANTS.TRUE_RESULT, aiapps};
    } catch(err) {
        LOG.error(`Error fetching AI apps for org ${jsonReq.org}, the error is: ${err}`);
        return CONSTANTS.FALSE_RESULT;
    }
}

const validateRequest = jsonReq => jsonReq.id && jsonReq.org;