/** 
 * (C) 2023 TekMonks. All rights reserved.
 * License: See enclosed LICENSE file.
 * 
 * Checks JWT tokerns or just org based API keys.
 */

const utils = require(`${CONSTANTS.LIBDIR}/utils.js`);
const login = require(`${NEURANET_CONSTANTS.APIDIR}/login.js`);

const CHECKER_NAME = "loginapp_key_checker";

function initSync() {
    APIREGISTRY.addCustomSecurityChecker(CHECKER_NAME, this);
}

async function checkSecurity(apiregentry, _url, req, headers, _servObject, reason) {
    if ((!req) || (!req.org)) {
        LOG.error(`Incoming request ${JSON.stringify(req)} does not have org key set. Authorization Rejected.`);
        reason.reason = "API Key Error"; reason.code = 403; return false; // loginapp uses org based keys for APIs
    }

    let allJWTClaimsCheck = true; // if the request carries a proper JWT, then use the stronger JWT check.
    if (apiregentry.query.loginapp_key_checker_enforce_for_jwt) for (const enforcedClaim of 
            utils.escapedSplit(apiregentry.query.loginapp_key_checker_enforce_for_jwt, ",")) {
    
        if (enforcedClaim.trim() == "id" && login.getID(headers) != req.id) allJWTClaimsCheck = false;
        if (enforcedClaim.trim() == "org" && login.getOrg(headers)?.toLowerCase() != req.org?.toLowerCase()) allJWTClaimsCheck = false;
    }
    if (allJWTClaimsCheck) return true; // request was properly JWT authorized, else all we can do next is an org key check
    
    LOG.warn(`Incoming request ${JSON.stringify(req)} for org ${req.org} is not carrying a proper JWT token, using weaker check to check for org keys only.`);
    if (await login.isAPIKeySecure(headers, req.org)) return true;

    LOG.error(`Incoming request ${JSON.stringify(req)} does not have a proper org key for the API.`);
    reason.reason = "API Key Error"; reason.code = 403; return false;   // key not found in the headers
}

module.exports = {checkSecurity, initSync};