/**
 * Deals with AI apps.
 * 
 * (C) 2023 TekMonks. All rights reserved.
 * License: See the enclosed LICENSE file.
 */

const yaml = require("yaml");
const path = require("path");
const fspromises = require("fs").promises;
const serverutils = require(`${CONSTANTS.LIBDIR}/utils.js`);
const timedcache = require(`${CONSTANTS.LIBDIR}/timedcache.js`);
const aiutils = require(`${NEURANET_CONSTANTS.LIBDIR}/aiutils.js`);
const dblayer = require(`${NEURANET_CONSTANTS.LIBDIR}/dblayer.js`);
const brainhandler = require(`${NEURANET_CONSTANTS.LIBDIR}/brainhandler.js`);

const APP_CACHE = {}, FLOWSECTION_CACHE = {}, DEBUG_MODE = NEURANET_CONSTANTS.CONF.debug_mode, TIMED_CACHE = timedcache.newcache(300000);
const BB_MESSAGE_KEY_PUBLISH = "_org_neuranet_aiapp_op_publish", BB_MESSAGE_KEY_UNPUBLISH = "_org_neuranet_aiapp_op_unpublish";
const CUSTOM_VIEW_PATH = "views/custom", XBIN_IGNORE_EXTENSION = "._____________xbin__________ignore_stats";

exports.DEFAULT_ENTRY_FUNCTIONS = {llm_flow: "answer", pregen_flow: "generate"};
exports.AIAPP_STATUS = {PUBLISHED: "published", UNPUBLISHED: "unpublished"};

exports.initSync = _ => {
    const sendToIfNotSeen = (msg, functionTo, args) => {    // avoid duplicate messages if the cluster is misconfigured etc.
        if (!TIMED_CACHE[msg.opid]) {TIMED_CACHE[msg.opid]=true; functionTo(...args);}
    }
    BLACKBOARD.subscribe(BB_MESSAGE_KEY_PUBLISH, message => sendToIfNotSeen(message, _pushAIAppViewForOrg, [message.id, message.org, message.aiappid, message.frontend_relative_webroot]));
    BLACKBOARD.subscribe(BB_MESSAGE_KEY_UNPUBLISH, message => sendToIfNotSeen(message, _deleteAIAppViewForOrg, [message.id, message.org, message.aiappid, message.frontend_relative_webroot]));
    _initAIApps();
}

/**
 * Returns the flow object of the YAML file for the given ai application
 * @param {string} id The user ID
 * @param {string} org The org
 * @param {string} aiappid The AI app ID
 * @param {string} flow_section The flow section name
 * @returns The flow object of the YAML file for the given ai application
 */
exports.getAIAppObject = async function(id, org, aiappid, flow_section) {
    aiappid = aiappid.toLowerCase(); org = org.toLowerCase();
    const app = await exports.getAIApp(id, org, aiappid), flowCacheKey = `${id}_${org}_${aiappid}_${flow_section}`;

    if (!app[flow_section]) return [];

    if (typeof app[flow_section] === "string") {  // flow is in an external file
        if (FLOWSECTION_CACHE[flowCacheKey] && (!DEBUG_MODE)) return FLOWSECTION_CACHE[flowCacheKey];
        else FLOWSECTION_CACHE[flowCacheKey] = app[flow_section].toLowerCase().endsWith("yaml") ?
            yaml.parse(await fspromises.readFile(`${_getAppDir(id, org, aiappid)}/${app[flow_section]}`, "utf8")) :
            JSON.parse(await fspromises.readFile(`${_getAppDir(id, org, aiappid)}/${app[flow_section]}`, "utf8"));
        return FLOWSECTION_CACHE[flowCacheKey];
    } else return app[flow_section];  // flow is inline
}

/**
 * Returns the LLM gen object (llm_flow) of the YAML file for the given ai application
 * @param {string} id The user ID
 * @param {string} org The org
 * @param {string} aiappid The AI app ID
 * @returns The LLM gen object (llm_flow) of the YAML file for the given ai application
 */
exports.getLLMGenObject = (id, org, aiappid) => exports.getAIAppObject(id, org, aiappid, "llm_flow");

/**
 * Returns the pre gen object (pregen_flow) of the YAML file for the given ai application
 * @param {string} id The user ID
 * @param {string} org The org
 * @param {string} aiappid The AI app ID
 * @returns The pre-gen (pregen_flow) object of the YAML file for the given ai application
 */
exports.getPregenObject = (id, org, aiappid) => exports.getAIAppObject(id, org, aiappid, "pregen_flow");

/**
 * Returns the AI app object itself - the overall AI app object.
 * @param {string} id The user ID
 * @param {string} org The org
 * @param {string} aiappid The AI app ID
 * @param {boolean} forcecache Force use of cache 
 * @returns The AI app object itself - the overall AI app object.
 */
exports.getAIApp = async function(id, org, aiappid, forcecache) {
    aiappid = aiappid.toLowerCase(); org = org.toLowerCase();
    const appCacheKey = `${org}_${aiappid}`;
    if ((forcecache || (!DEBUG_MODE)) && APP_CACHE[appCacheKey]) return APP_CACHE[appCacheKey];

    try {
        const appFile = exports.getAppFile(id, org, aiappid), appFileYaml = await fspromises.readFile(appFile, "utf8"),
            app = yaml.parse(appFileYaml); app.org = org; APP_CACHE[appCacheKey] = app;
        return APP_CACHE[appCacheKey];
    } catch (err) { // app file parsing issue
        if (!NEURANET_CONSTANTS.CONF.dynamic_aiapps) {  // dynamic apps not supported, we can't do anything else
            LOG.error(`AI app parsing error for app ID ${aiappid} for org ${org}.`);
            throw err; 
        }

        // dynamic app support will allow for partitioned DBs with app IDs but using default YAML as the app definition
        LOG.warn(`Using dynamic app for app ID ${aiappid} for org ${org}, as static app for this ID not found.`);
        const aiappidDefaultForOrg = await exports.getDefaultAppIDForOrg(org), 
            appFileDefaultForOrg = exports.getAppFile(id, org, aiappidDefaultForOrg),
            appDefaultYamlForOrg = await fspromises.readFile(appFileDefaultForOrg, "utf8");
        const appDefaultForOrg = yaml.parse(appDefaultYamlForOrg); appDefaultForOrg.id = aiappid;
        return appDefaultForOrg;
    }
}

/**
 * Returns the default AI app
 * @return {object} The default AI app object
 */
exports.getDefaultAIApp = async _ => {
    const aiappidDefault = await exports.getDefaultAppIDForOrg(NEURANET_CONSTANTS.DEFAULT_ORG), 
        appFileDefault = await exports.getAppFile(NEURANET_CONSTANTS.DEFAULT_ID, NEURANET_CONSTANTS.DEFAULT_ORG, aiappidDefault),
        appDefaultYaml = await fspromises.readFile(appFileDefault, "utf8");
    const app = yaml.parse(appDefaultYaml);
    return app;
}

/**
 * Returns AI model taking into account app's global overrides.
 * @param {string} model_name The model name
 * @param {object} model_overrides The overrides for this model, or undefined if none
 * @param {string} id The ID - if not provided then global overrides don't take effect
 * @param {string} org The org - if not provided then global overrides don't take effect
 * @param {string} aiappid The AI app ID - if not provided then global overrides don't take effect
 * @returns The AI model taking into account app's global overrides.
 */
exports.getAIModel = async function(model_name, model_overrides={}, id, org, aiappid) {
    aiappid = aiappid.toLowerCase(); org = org.toLowerCase();
    const aiapp = (id && org && aiappid) ? await exports.getAIApp(id, org, aiappid) : {global_models: []};
    let globalOverrides = {}; for (const globalModel of aiapp.global_models) if (globalModel.name == model_name) {
        globalOverrides = globalModel.model_overrides; break; }
    const final_overrides = {...globalOverrides, ...model_overrides};
    return await aiutils.getAIModel(model_name, final_overrides);
}

/**
 * Returns the JS module, whether plugin or loaded from app, for YAML command modules
 * @param {string} id The user ID
 * @param {string} org The org
 * @param {string} aiappid The AI app ID
 * @param {string} command The command name
 * @return The JS module, whether plugin or loaded from app, for YAML command modules
 */
exports.getCommandModule = async function(id, org, aiappid, command) {
    aiappid = aiappid.toLowerCase(); org = org.toLowerCase();
    const aiapp = await exports.getAIApp(id, org, aiappid);
    if (aiapp.modules?.[command]) return require(`${exports.getAppDir(id, org, aiappid)}/${aiapp.modules[command]}`);
    else return await NEURANET_CONSTANTS.getPlugin(command);    // if it is not part of the app then must be built-in
}

/**
 * Returns AI application directory.
 * @param {string} id The user ID
 * @param {string} org The org
 * @param {string} aiappid The AI app ID
 * @returns AI application directory.
 */
exports.getAppDir = (id, org, aiappid) => exports.isThisDefaultOrgsDefaultApp(id, org, aiappid) ?
    `${NEURANET_CONSTANTS.AIAPPDIR}/${NEURANET_CONSTANTS.DEFAULT_ORG}/${NEURANET_CONSTANTS.DEFAULT_ORG_DEFAULT_AIAPP}` : 
    `${NEURANET_CONSTANTS.AIAPPDIR}/${org}/${aiappid}`;
    
/**
 * Returns the list of all AI apps for the given org.
 * @param {string} id The user ID
 * @param {string} org The org
 * @param {boolean} onlyPublished If true then only published apps are returned
 * @param {boolean} initOrg If true the org's list of apps is initialized if empty by publishing the default app to it
 * @returns Array of AI app objects for given org (complete YAML objects)
 */
exports.getAllAIAppsForOrg = async (id, org, onlyPublished, initOrg=false) => {
    const orgLower = org.toLowerCase(), idLower = id.toLowerCase();
    const aiappsDB = await dblayer.getAllAIAppsForOrg(orgLower, onlyPublished?exports.AIAPP_STATUS.PUBLISHED:undefined);
    const retAiAppObjects = []; for (const aiappThis of aiappsDB) {
        let aiappObject; try {aiappObject = await exports.getAIApp(idLower, orgLower, aiappThis.aiappid);} catch (err) {
            LOG.error(`Error parsing AI app ${aiappThis} for org ${orgLower} skipping.`);
        }
        if (aiappObject) retAiAppObjects.push(aiappObject);
    }
    if ((!retAiAppObjects.length) && initOrg) { // init a new org with default app if the flag is set
        const aiappDefault = await exports.getDefaultAIApp();   // default AI app for the default org
        if (!(await exports.initNewAIAppForOrg(aiappDefault.id, aiappDefault.interface.label, idLower, orgLower, aiappDefault.id))) {
            LOG.error(`Unable to initialize default AI app for org ${org}, init failed.`); return []; }
        if (!(await exports.publishAIAppForOrg(aiappDefault.id, orgLower))) {
            LOG.error(`Unable to initialize default AI app for org ${org}, publish failed.`);return []; }
        await exports.setDefaultAppIDForOrg(orgLower, aiappDefault.id);  // make the first app as the org's default app unless changed
        retAiAppObjects.push(await exports.getAIApp(idLower, orgLower, aiappDefault.id));
    }
    return retAiAppObjects;
}

/**
 * Returns the templates for default apps we can use to create new apps etc.
 * @returns Array of objects in format {id, label} where label is UI label
 */
exports.getAppTemplates = async function() {
    const defaultOrgAIAppsDir = `${NEURANET_CONSTANTS.AIAPPDIR}/${NEURANET_CONSTANTS.DEFAULT_ORG}`;
    const templates = [];
    for (const appFolder of (await fspromises.readdir(defaultOrgAIAppsDir, {withFileTypes: true}))) {
        if (!appFolder.isDirectory()) continue;
        try {
            const aiappidThis = appFolder.name, aiappThis = await exports.getAIApp(NEURANET_CONSTANTS.DEFAULT_ID, 
                NEURANET_CONSTANTS.DEFAULT_ORG, aiappidThis), label = aiappThis.interface.label;
            templates.push({id: aiappidThis, label});
        } catch (err) {/* Just silently ignore bad templates*/}
    }
    return templates;
}

/**
 * Initializes and adds the given AI app for the given org, but doesn't
 * publish it.
 * @param {string} aiappid The AI app ID
 * @param {string} label The AI app label for the interface section
 * @param {string} id The user ID
 * @param {string} org The org
 * @param {string} template The app template
 * @returns true on success or false on failure
 */
exports.initNewAIAppForOrg = async function(aiappid, label, id, org, template=NEURANET_CONSTANTS.DEFAULT_ORG_DEFAULT_AIAPP) {    
    aiappid = aiappid.toLowerCase(); org = org.toLowerCase();
    const defaultAppDir = exports.getAppDir(NEURANET_CONSTANTS.DEFAULT_ID, NEURANET_CONSTANTS.DEFAULT_ORG, 
        template), newAppDir = exports.getAppDir(id, org, aiappid);

    const logErrorExists = LOG.error(`AI app init failed for ${org} for AI app ${aiappid} due to existing app.`);
    try {await fspromises.access(newAppDir); logErrorExists(); return false;} catch (err) { // don't overwrite existing apps
        if (err.code !== "ENOENT") {logErrorExists(); return false;} };

    const fileindexer = require(`${NEURANET_CONSTANTS.LIBDIR}/fileindexer.js`); // moving this to the top causes circular dependency between aidbfs (which needs aiapp) and fileindexer.js (which needs aidbfs)
    const aidbfs = require(`${NEURANET_CONSTANTS.LIBDIR}/aidbfs.js`);   // avoid cyclic requires

    try {
        let result = true; serverutils.walkFolder(defaultAppDir, async (fullpath, _stats, relativePath) => {
            if (!result) return;    // already failed, no point wasting time walking further
            if (relativePath.toLowerCase().endsWith(".yaml")) relativePath = relativePath.replace(NEURANET_CONSTANTS.DEFAULT_ORG_DEFAULT_AIAPP, aiappid);    // replace app ID in path
            let fileContents = await fspromises.readFile(fullpath, "utf8");
            if (fullpath.toLowerCase().endsWith(".yaml")) fileContents = fileContents.replace(    // fix app IDs and labels
                NEURANET_CONSTANTS.DEFAULT_ORG_DEFAULT_AIAPP, aiappid).replace(
                    `label: ${NEURANET_CONSTANTS.DEFAULT_ORG_DEFAULT_AIAPP_LABEL}`, `label: ${label}`); 
            const fileBuffer = Buffer.from(fileContents, "utf8");
            result = await fileindexer.addFileToCMSRepository(id, org,  // app dir is CMS managed so this is needed
                fileBuffer, relativePath, `AI app file for ${aiappid}`, brainhandler.createExtraInfo(
                    id, org, aiappid, undefined, NEURANET_CONSTANTS.AIAPPMODES.EDIT), true);    // no ai event is true as we don't add this file to the AI
        });
        if (result) {
            const aidbRoot = `${NEURANET_CONSTANTS.AIDBPATH}`;
            const appdbFolderPath = `${aidbRoot}/${aidbfs.getDBID(id, org, aiappid)}`;  // create ai app's DB dir for AI DBs
            await serverutils.createDirectory(appdbFolderPath);
            result = await dblayer.addOrUpdateAIAppForOrg(org, aiappid, exports.AIAPP_STATUS.UNPUBLISHED);
        } else {
            LOG.error(`DB update for AI app ${aiappid} for org ${org} failed.`);
            try {await serverutils.rmrf(newAppDir);} catch (err) {LOG.error(`Error ${err} cleaning up ${newAppDir} for org ${org}.`);}
        }
        return result;
    } catch (err) {
        LOG.error(`AI app init failed for ${org} for AI app ${aiappid} due to error ${err}`);
        return false;
    }
}

/**
 * Deletes the given AI app for the given org.
 * @param {string} aiappid The AI app ID
 * @param {string} id The user ID
 * @param {string} org The org
 * @returns true on success or false on failure
 */
exports.deleteAIAppForOrg = async function (aiappid, id, org, frontend_relative_webroot) {
    const appDir = exports.getAppDir(id, org, aiappid);
    aiappid = aiappid.toLowerCase(); org = org.toLowerCase();
    const aidbfs = require(`${NEURANET_CONSTANTS.LIBDIR}/aidbfs.js`);   // avoid cyclic requires
    const aidbRoot = `${NEURANET_CONSTANTS.AIDBPATH}`;
    const appdbArchiveDirPath = `${aidbRoot}/archive`, appdbFolderPath = `${aidbRoot}/${aidbfs.getDBID(id, org, aiappid)}`;  // save uploaded data
    const zipFilePath = `${appdbArchiveDirPath}/${aiappid}.zip`;
    let result; 
    try {
        await serverutils.createDirectory(appdbArchiveDirPath);
        await serverutils.zipFolder(appdbFolderPath, zipFilePath);
        await serverutils.rmrf(appdbFolderPath);    // delete trained DBs
        BLACKBOARD.publish(BB_MESSAGE_KEY_UNPUBLISH, {id, org, aiappid, frontend_relative_webroot});    // delete frontend
        result = await serverutils.rmrf(appDir);    // delete app itself
    } catch (err) {
        LOG.error(`Error deleting AI app for org ${org}: ${err.message}`);
        return false;
    }
    if (!result) {
        LOG.error(`Error deleting hosting folder for app ${aiappid} for org ${org}.`);
        return false;
    } else {
        return await dblayer.deleteAIAppforOrg(org, aiappid);
    }
}

/**
 * Checks if the given app is already published.
 * @param {string} aiappid The AI app ID
 * @param {string} org The org
 * @returns true if it is already published else false
 */
exports.isPublished = async function(aiappid, org) {
    const app = await dblayer.getAIAppForOrg(org, aiappid);
    if (app) return app.status == exports.AIAPP_STATUS.PUBLISHED; 
    else return false;
}

/**
 * Publishes (but doesn't add) the given AI app for the given org.
 * @param {string} aiappid The AI app ID
 * @param {string} id The user ID
 * @param {string} org The org
 * @param {string} frontend_relative_webroot The app's webroot relative to the frontend directory
 * @returns true on success or false on failure
 */
exports.publishAIAppForOrg = async function(aiappid, id, org, frontend_relative_webroot) { 
    aiappid = aiappid.toLowerCase(); org = org.toLowerCase();

    let timeoutWaitUnpublish = 0;
    if (await exports.isPublished(aiappid, org)) {
        await exports.unpublishAIAppForOrg(aiappid, id, org, frontend_relative_webroot); 
        timeoutWaitUnpublish = NEURANET_CONSTANTS.unpublish_cluster_sync_wait;  // so frontend files are deleted across the cluster
    }

    const randomID = `${Date.now()}${Math.ceil(Math.random()*10000)}`;
    setTimeout(_=>BLACKBOARD.publish(BB_MESSAGE_KEY_PUBLISH, {opid: randomID, id, org, aiappid, frontend_relative_webroot}), timeoutWaitUnpublish);
    
    return await dblayer.addOrUpdateAIAppForOrg(org, aiappid, exports.AIAPP_STATUS.PUBLISHED);
}

/**
 * Unpublishes (but doesn't delete) the given AI app for the given org.
 * @param {string} aiappid The AI app ID
 * @param {string} id The user ID
 * @param {string} org The org
 * @param {string} frontend_relative_webroot The app's webroot relative to the frontend directory
 * @returns true on success or false on failure
 */
exports.unpublishAIAppForOrg = async function(aiappid, id, org, frontend_relative_webroot) {
    aiappid = aiappid.toLowerCase(); org = org.toLowerCase();  
    const randomID = `${Date.now()}${Math.ceil(Math.random()*10000)}`;
    BLACKBOARD.publish(BB_MESSAGE_KEY_UNPUBLISH, {opid: randomID, id, org, aiappid, frontend_relative_webroot});
    return await dblayer.addOrUpdateAIAppForOrg(org, aiappid, exports.AIAPP_STATUS.UNPUBLISHED);
}

/**
 * Returns the default app ID for an org
 * @param {string} org The org whose default AI app ID is needed
 * @returns The default app ID for an org
 */
exports.getDefaultAppIDForOrg = async function (org) {
    const orgSettings = await dblayer.getOrgSettings(org);
    return orgSettings.defaultapp || await exports.getDefaultAppIDForOrg(NEURANET_CONSTANTS.DEFAULT_ORG);
}

/**
 * Sets the default app ID for an org
 * @param {string} org The org whose default AI app ID is to be set
 * @param {string} aiappid The new default app ID
 * @returns true on success and false or undefined on errors
 */
exports.setDefaultAppIDForOrg = async function (org, aiappid) {
    const orgSettings = await dblayer.getOrgSettings(org);
    orgSettings.defaultapp = aiappid;
    return dblayer.setOrgSettings(org, orgSettings);
}

/**
 * Returns true if the given id, org and aiappid belong instead to the default org and default app
 * @param {string} _id The ID (not used)
 * @param {string} _org The org (not used)
 * @param {string} aiappid The app ID to be tested 
 * @returns true if the given id, org and aiappid belong instead to the default org and default app
 */
exports.isThisDefaultOrgsDefaultApp = (_id, _org, aiappid) => aiappid == NEURANET_CONSTANTS.DEFAULT_ORG_DEFAULT_AIAPP;

/**
 * Returns the app ID to use for a given request.
 * @param {string} id The ID 
 * @param {string} org The org 
 * @param {*} extraInfo The associated extraInfo object
 * @returns The app ID to use for a given request.
 */
exports.getAppID = async function(idIn, orgIn, extraInfo) {
    const {id, org, aiappid} = brainhandler.unmarshallExtraInfo(extraInfo);

    // everything is ok so use what is requested
    if (extraInfo && (id == idIn) && (org == orgIn) && (aiappid)) return aiappid;    

    // if this org has a default app then use that if missing
    if (orgIn) {
        const orgSettings = await dblayer.getOrgSettings(orgIn);
        if (orgSettings.defaultapp) return orgSettings.defaultapp; 
    } 

    // finally failover to default org's default AI app
    return NEURANET_CONSTANTS.DEFAULT_ORG_DEFAULT_AIAPP; 
}

/**
 * Returns AI application file.
 * @param {string} id The user ID
 * @param {string} org The org
 * @param {string} aiappid The AI app ID
 * @returns AI application file.
 */
exports.getAppFile = (id, org, aiappid) => `${exports.getAppDir(id, org, aiappid)}/${aiappid}.yaml`;

async function _pushAIAppViewForOrg(id, org, aiappid, frontend_relative_webroot) {
    const appFrontendDir = path.resolve(`${CONSTANTS.FRONTENDDIR}/${frontend_relative_webroot}`);
    const viewDir = `${appFrontendDir}/${CUSTOM_VIEW_PATH}/${org}/${aiappid}`;
    const appFrontEndDir = `${exports.getAppDir(id, org, aiappid)}/frontend`;
    if (!(await serverutils.exists(appFrontEndDir))) return;    // nothing to do

    try {
        try {await fspromises.mkdir(viewDir, {recursive: true})} catch (err) {if (err.code != "EEXIST") throw err;}
        const copyPromises = []; for (const fileOrFolder of (await fspromises.readdir(appFrontEndDir)))
            copyPromises.push(await serverutils.copyFileOrFolder(
                `${appFrontEndDir}/${fileOrFolder}`, `${viewDir}/${fileOrFolder}`, undefined, undefined, 
                entry => (!entry.endsWith(XBIN_IGNORE_EXTENSION))));
        try {await Promise.all(copyPromises); return true} catch (err) {if (err.code != "EEXIST") throw err;}
    } catch (err) {
        LOG.error(`Error ${err} copying view to the frontend for for app ID ${aiappid} for org ${org}`);
        return false;
    }
}

async function _deleteAIAppViewForOrg(id, org, aiappid, frontend_relative_webroot) {
    const appFrontEndDir = `${exports.getAppDir(id, org, aiappid)}/frontend`;
    if (!(await serverutils.exists(appFrontEndDir))) return;    // nothing to do

    const appFrontendDir = path.resolve(`${CONSTANTS.FRONTENDDIR}/${frontend_relative_webroot}`);
    const viewDir = `${appFrontendDir}/${CUSTOM_VIEW_PATH}/${org}/${aiappid}`;
    try {serverutils.rmrf(viewDir);} catch (err) {LOG.error(`Error ${err} deleting view from the frontend for for app ID ${aiappid} for org ${org}`)}
}

async function _initAIApps() {
    for (const org of await fspromises.readdir(NEURANET_CONSTANTS.AIAPPDIR)) {
        if (org == NEURANET_CONSTANTS.DEFAULT_ORG) continue;    // these are templates
        if (!(await fspromises.stat(`${NEURANET_CONSTANTS.AIAPPDIR}/${org}`)).isDirectory()) continue;  // not a proper org
        
        for (const aiappid of await fspromises.readdir(`${NEURANET_CONSTANTS.AIAPPDIR}/${org}`)) {
            const initFile = `${NEURANET_CONSTANTS.AIAPPDIR}/${org}/${aiappid}/init.js`;
            if (await serverutils.exists(initFile)) require(initFile).initAsync(org, aiappid);
        }
    }
}