/**
 * Login listener to inject Neuranet data into logins.
 * (C) 2023 TekMonks. All rights reserved.
 */


const aiapp = require(`${NEURANET_CONSTANTS.LIBDIR}/aiapp.js`);
const login = require(`${NEURANET_CONSTANTS.APIDIR}/login.js`);

exports.initSync = _ => login.addLoginListener(`${NEURANET_CONSTANTS.LIBDIR}/loginhandler.js`, "viewInjector");

exports.viewInjector = async function(result) {
    if (result.tokenflag) {     
        try {   // add in all AI apps the user has access to or emtpy apps in case of DB errors
            const aiapps = (await aiapp.getAllAIAppsForOrg(result.id, result.org, true, true))||[], aiappsForUser = [];
            for (const aiappThis of aiapps) {
                const aiappObject = await aiapp.getAIApp(result.id, result.org, aiappThis.id),
                    usersThisApp = aiappObject?aiappObject.users:[], adminsThisApp = aiappObject?aiappObject.admins:[];
                if (usersThisApp.includes('*') || usersThisApp.some(id => id.toLowerCase() == result.id.toLowerCase()))
                    aiappsForUser.push({id: aiappObject.id, interface: aiappObject.interface, 
                        endpoint: aiappObject.endpoint, 
                        is_user_appadmin: adminsThisApp.some(id => id.toLowerCase() == result.id.toLowerCase())});
            }
            result.apps = aiappsForUser; 
        } catch(err) {
            LOG.error(`Error fetching AI apps for org ${result.org}, the error is: ${err}`);
            result.apps = [];
        }
        return true;
    } return false;
}
