/**
 * Unified interface for AI DB file handling. Other services should use this
 * for DB file ingestion, uningestion and update operations. 
 * 
 * Internally can ingest into configured AI databases. These are configured in the AI app's
 * YAML files.
 * 
 * Neuranet Distributed DB design 
 * 	- Xbin Publishes the event to the entire distributed cluster, NFS volume is shared
 * 	- Neuranet (fileindexer) - catches only the local events for the cluster so only the NN
 *    local cluster, of which the XBin node which received the file is a part of processes 
 *    the file. Each local cluster node processes them independently, thus local cluster 
 *    eventually syncs
 * 	- This causes disjoint distributed AI DB across the distributed cluster as some files are in some
 *    local clusters and others are in the other. Thus, the load balancer for XBin decides the file
 *    distribution and individual cluster balancing. 
 * 	- So queries need entire distributed cluster to respond (allows large DBs and distributed processing)
 * 	
 * 	- Delete and updates - the server receiving the XBin event may not have the files in the AI DB, as 
 *    the DBs are disjoint so they need to be send to the external cluster members to sync 
 * 	
 * 	- Create can always be local as DBs are disjoint by design
 * 
 * (C) 2023 TekMonks. All rights reserved.
 * License: See the enclosed LICENSE file.
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const quota = require(`${NEURANET_CONSTANTS.LIBDIR}/quota.js`);
const aiapp = require(`${NEURANET_CONSTANTS.LIBDIR}/aiapp.js`);
const conf = require(`${NEURANET_CONSTANTS.CONFDIR}/aidb.json`);

const REASONS = {INTERNAL: "internal", OK: "ok", VALIDATION:"badrequest", LIMIT: "limit"}, UNKNOWN_ORG = "unknownorg";

/** Inits the module, must be called in the app init */
exports.initSync = function() {
    if (conf.aidbs_to_init) for (const db of conf.aidbs_to_init) {
        const dbThis = NEURANET_CONSTANTS.getPlugin(db);
        dbThis.init();
    }
}

/**
 * Ingests the given file into the AI DBs. It must be a simple text file.
 * @param {string} pathIn The path to the file
 * @param {string} referencelink The reference link for the document
 * @param {string} id The user ID
 * @param {string} org The user ORG
 * @param {string} brainid The brain ID
 * @param {string} lang The language to use to ingest. If omitted will be autodetected.
 * @param {object} streamGenerator A read stream generator for this file, if available, else null. Must be a text stream.
 * @param {object} metadata The file's associated metadata, or null
 * @returns A promise which resolves to {result: true|false, reason: reason for failure if false}
 */
exports.ingestfile = async function(pathIn, referencelink, id, org, brainid, lang, streamGenerator, metadata={}) {
    LOG.info(`AI DB FS ingestion of file ${pathIn} for ID ${id} and org ${org} started.`);
    const timeStart = Date.now(), aiappThis = await aiapp.getAIApp(id, org, brainid, true);
    if ((!(aiappThis.disable_quota_checks)) && (!(await quota.checkQuota(id, org, brainid)))) {
		LOG.error(`Disallowing the ingest call for the path ${pathIn}, as the user ${id} of org ${org} is over their quota.`);
		return {reason: REASONS.LIMIT, ...CONSTANTS.FALSE_RESULT};
	}
    LOG.info(`Time taken till quota check for ${pathIn} is ${(Date.now()-timeStart)} ms.`);

    const metadataFinal = {...metadata, id, date_created: Date.now(), fullpath: pathIn}; 
    metadataFinal[NEURANET_CONSTANTS.NEURANET_DOCID] = exports.getDocID(pathIn); 
    metadataFinal[NEURANET_CONSTANTS.REFERENCELINK_METADATA_KEY] = encodeURI(referencelink||exports.getDocID(pathIn));

    const _getExtractedTextStream = _ => streamGenerator ? streamGenerator() : fs.createReadStream(pathIn);

    // ingest into the DBs configured
    const dbsIngested = [];
    for (const db of aiappThis.ingestiondbs) {
        const dbThis = NEURANET_CONSTANTS.getPlugin(db);
        LOG.info(`Starting text extraction and ${dbThis.name} ingestion of file ${pathIn}.`);
        try { 
            await dbThis.createStream(id, org, brainid, await _getExtractedTextStream(), metadataFinal, lang); 
            LOG.info(`Time taken till ${dbThis.name} ingestion of file ${pathIn}} is ${(Date.now()-timeStart)} ms.`);
            dbsIngested.push(dbThis);
        } catch (err) {
            LOG.error(`${dbThis.name} ingestion failed for path ${pathIn} for DB ${dbThis.name} for ID ${id} and org ${org} with error ${err}.`); 
            for (const dbIngested of dbsIngested) try {dbIngested.uningestfile(pathIn, id, org, brainid)} catch (err) { // try to keep the DBs in sync
                LOG.error(`DB uningestion failed for file ${pathIn} for id ${id} and org ${org} due to error ${err}.`);
                LOG.error(`AI DBs are out of sync. Manual cleanup needed for file ${pathIn}.`);
            }
            return {reason: REASONS.INTERNAL, ...CONSTANTS.FALSE_RESULT};
        }
    }

    LOG.info(`AI DB FS ingestion of file ${pathIn} for ID ${id} and org ${org} succeeded.`);
    LOG.info(`Time taken till full ingestion of file ${pathIn}} is ${(Date.now()-timeStart)} ms.`);
    return {reason: REASONS.OK, ...CONSTANTS.TRUE_RESULT};
}

/**
 * Flushes the databases to the file system used during ingestion.
 * @param {string} id The user ID
 * @param {string} org The user ORG
 * @param {string} brainid The brain ID
 * @throws Exception on error
 */
exports.flush = async function(id, org, brainid) {
    const aiappThis = await aiapp.getAIApp(id, org, brainid, true);
    for (const db of aiappThis.ingestiondbs) {
        const dbThis = NEURANET_CONSTANTS.getPlugin(db);
        await dbThis.flush(id, org, brainid); 
    }
}

/**
 * Removes the given file from AI DBs.
 * @param {string} pathIn The path to the file
 * @param {string} id The user ID
 * @param {string} org The user ORG
 * @param {string} brainid The brain ID
 * @returns A promise which resolves to {result: true|false, reason: reason for failure if false}
 */
exports.uningestfile = async function(pathIn, id, org, brainid) {
    const aiappThis = await aiapp.getAIApp(id, org, brainid, true);
    try {
        for (const db of aiappThis.ingestiondbs) {
            const dbThis = NEURANET_CONSTANTS.getPlugin(db);
            await dbThis.uningestfile(pathIn, id, org, brainid); 
        }
        return {reason: REASONS.OK, ...CONSTANTS.TRUE_RESULT};
    } catch (err) {
        LOG.error(`Document to uningest at path ${pathIn} for ID ${id} and org ${org} had errors: ${err}. DB that failed was ${dbThis.name}.`);
        LOG.error(`AI DBs are out of sync. Manual cleanup needed for file ${pathIn}.`);
        return {reason: REASONS.INTERNAL, ...CONSTANTS.FALSE_RESULT};
    }
}

/**
 * Renames the given file in AI DB and their associated metadatas.
 * @param {string} from The path from
 * @param {string} to The path to
 * @param {string} new_referencelink The new reference link
 * @param {string} id The user ID
 * @param {string} org The user ORG
 * @param {string} brainid The brain ID
 * @returns A promise which resolves to {result: true|false, reason: reason for failure if false}
 */
exports.renamefile = async function(from, to, new_referencelink, id, org, brainid) {
    try {
        const aiappThis = await aiapp.getAIApp(id, org, brainid, true);
        for (const db of aiappThis.ingestiondbs) {
            const dbThis = NEURANET_CONSTANTS.getPlugin(db);
            await dbThis.renamefile(from, to, new_referencelink, id, org, brainid); 
        }
        LOG.info(`Rename of file from ${from} to ${to} for ID ${id} and org ${org} succeeded.`)
        return {reason: REASONS.OK, ...CONSTANTS.TRUE_RESULT};
    } catch (err) {
        LOG.error(`Rename of file from ${from} to ${to} for ID ${id} and org ${org} had errors: ${err}. DB that failed was ${dbThis.name}.`);
        LOG.error(`AI DBs are out of sync. Manual cleanup needed for file ${from}.`);
        return {reason: REASONS.INTERNAL, ...CONSTANTS.FALSE_RESULT};
    }
}

exports.getDBID = (_id, org, brainid) => `${(org||UNKNOWN_ORG).toLowerCase()}/${brainid}`;

exports.getDocID = pathIn => crypto.createHash("md5").update(path.resolve(pathIn)).digest("hex");