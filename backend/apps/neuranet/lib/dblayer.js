/**
 * Database layer for the Neuranet app.
 * 
 * (C) 2022 TekMonks. All rights reserved.
 * See enclosed LICENSE file.
 */

const path = require("path");
const utils = require(`${CONSTANTS.LIBDIR}/utils.js`);
const DB_PATH = (NEURANET_CONSTANTS.CONF.db_server_host||"")+path.resolve(`${NEURANET_CONSTANTS.DBDIR}/neuranet.db`).replaceAll(path.sep, path.posix.sep)
const DB_CREATION_SQLS = require(`${NEURANET_CONSTANTS.DBDIR}/neuranet_dbschema.json`);
const db = require(`${CONSTANTS.LIBDIR}/db.js`).getDBDriver("sqlite", DB_PATH, DB_CREATION_SQLS);

const DB_CACHE = {};

exports.initDBAsync = async noerror => {try {await db.init();} catch (err) {if (noerror) LOG.error(`Error initializing the DB: ${err}`); else throw err;}}

exports.logUsage = async (id, usage=0, model) => db.runCmd("INSERT INTO usage (id, usage, model) values (?,?,?)", [id, usage, model]);

exports.getAIModelUsage = async (id, startTimestamp, endTimestamp, model) => {
	const usage = await db.getQuery("SELECT sum(usage) AS totaluse FROM usage WHERE timestamp >= ? AND timestamp <= ? AND id=? AND model=?",
		[startTimestamp, endTimestamp, id, model]);
	if ((!usage) || (!usage.length) || (!usage[0].totaluse)) {
		LOG.debug(`No usage found for ID ${id}, model ${model} between the timestamps ${startTimestamp} and ${endTimestamp}.`);
		return 0;
	} else try { return parseFloat(usage[0].totaluse); } catch (err) {LOG.error(`Error parsing usage ${usage[0].totaluse} for ID ${id}, model ${model} between the timestamps ${startTimestamp} and ${endTimestamp}, returning 0.`); return 0;}
} 

exports.getQuota = async (id, org) => {
	const _parseQuota = quota => { try { return parseFloat(quota[0].quota); } catch (err) { LOG.error(
		`Error parsing quota ${quota[0].quota} for ID ${id}.`); return -1; } }
	
	let quota; 
	
	quota = await db.getQuery("SELECT quota FROM quotas WHERE id=? AND org=? COLLATE NOCASE", [id, org]);
	if ((!quota) || (!quota.length)) LOG.warn(`No quota found for id ${id} under org ${org}.`); 

	quota = await db.getQuery("SELECT quota FROM quotas WHERE id=? AND org=? COLLATE NOCASE", 
		[NEURANET_CONSTANTS.DEFAULT_ID, org]);
	if ((!quota) || (!quota.length)) LOG.warn(`No default quota found for org ${org}.`); 
	else {LOG.debug(`Using default quota of ${quota[0].quota} for org ${org}.`); return _parseQuota(quota);}

	quota = await db.getQuery("SELECT quota FROM quotas WHERE id=? AND org=? COLLATE NOCASE", 
		[NEURANET_CONSTANTS.DEFAULT_ID, NEURANET_CONSTANTS.DEFAULT_ORG]);
	if ((!quota) || (!quota.length)) {LOG.error(`No default quota found at all.`); return -1;}
	else {LOG.debug(`Using default quota of ${quota[0].quota} for ${id}.`); return _parseQuota(quota);}
}

exports.getOrgSettings = async function(org) {
	const query = "SELECT settings FROM orgsettings WHERE org=? COLLATE NOCASE";
	const cachedValue = _getDBCache(query, [org]);
	if (cachedValue) return cachedValue;

	const orgSettings = await db.getQuery(query, [org]);
	if ((!orgSettings) || (!orgSettings.length)) {
		LOG.warn(`No org settings found for org ${org}.`);
		return {};
	} else { const settings = JSON.parse(orgSettings[0].settings); _setDBCache(query, [org], settings); return settings; }
}

exports.setOrgSettings = async function(org, settings) {
	const result = await db.runCmd("INSERT OR REPLACE INTO orgsettings (org, settings) VALUES (?,?)", 
		[org, JSON.stringify(settings)]);
	if (result) _setDBCache("SELECT settings FROM orgsettings WHERE org=? COLLATE NOCASE", [org], settings);
	return result;
}

exports.getAllAIAppsForOrg = async function(org, status) {
	const query = status?"SELECT * FROM aiapps WHERE org=? COLLATE NOCASE AND status=?" : "SELECT * FROM aiapps WHERE org=? COLLATE NOCASE";
	
	const aiapps = await db.getQuery(query, status?[org, status]:[org]);
	if ((!aiapps) || (!aiapps.length)) {
		LOG.warn(`No ai apps found for org ${org}.`);
		return [];
	} else return aiapps;
}

exports.getAIAppForOrg = async function(org, aiappid) {
	const query = "SELECT * FROM aiapps WHERE id=? COLLATE NOCASE";
	
	const aiapps = await db.getQuery(query, [`${org.toLowerCase()}_${aiappid.toLowerCase()}`]);
	if ((!aiapps) || (!aiapps.length)) {
		LOG.warn(`No aiapps named ${aiappid} found for org ${org}.`);
		return [];
	} else return aiapps[0];
}

exports.addOrUpdateAIAppForOrg = async function(org, aiappid, status) {
	const query = "REPLACE INTO aiapps (id, org, aiappid, status) values (?,?,?,?)";
	
	const result = await db.runCmd(query, [`${org.toLowerCase()}_${aiappid.toLowerCase()}`, org, aiappid, status]);
	return result;
}

exports.deleteAIAppforOrg = async function(org, aiappid) {
	const query = "DELETE FROM aiapps where id = ?";
	
	const result = await db.runCmd(query, [`${org.toLowerCase()}_${aiappid.toLowerCase()}`]);
	return result;
}

const _setDBCache = (query, params, result) => DB_CACHE[_getQueryHash(query, params)] = utils.clone(result);
const _getDBCache = (query, params) => DB_CACHE[_getQueryHash(query, params)];
const _getQueryHash = (query, params) => utils.hashObject([query, ...params]);

function _flattenArray(results, columnName, functionToCall) { 
	if (!results) return [];
	const retArray = []; for (const result of results) retArray.push(
		functionToCall?functionToCall(result[columnName]):result[columnName]); return retArray;
}