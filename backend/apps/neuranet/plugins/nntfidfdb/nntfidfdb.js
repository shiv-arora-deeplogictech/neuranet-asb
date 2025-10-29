/**
 * Plugin for Neuranet's built in TF.IDF DB.
 * 
 * (C) 2022 TekMonks. All rights reserved.
 * License: See the enclosed LICENSE file.
 */

const aitfidfdb = require(`${__dirname}/aitfidfdb.js`);
const aidbfs = require(`${NEURANET_CONSTANTS.LIBDIR}/aidbfs.js`);

/** Inits the plugin, must be called */
exports.init = function() {aitfidfdb.init()};

/** The DB plugin name */
exports.name = "TF.IDF DB"; 

/**
 * Ingests the given stream into Neuranet's built in TF.IDF DB
 * @param {string} id The ID of the user active
 * @param {string} org The org of the user active
 * @param {string} brainid The brain ID
 * @param {Object} stream The stream of text
 * @param {Object} metadata The associated metadata
 * @param {string} lang The language of the stream
 * @throws {Object} Error objects on errors 
 */
exports.ingestStream = exports.createStream = async function(id, org, brainid, stream, metadata, lang) {
    const tfidfDB = await _getTFIDFDBForIDAndOrgAndBrainID(id, org, brainid); 
    try {await tfidfDB.createStream(stream, metadata, lang);} catch (err) {
        LOG.error(`TF.IDF ingestion failed for ID ${id} and org ${org} with error ${err}.`); 
        throw err;
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
    // delete from the TF.IDF DB
    const docID = aidbfs.getDocID(pathIn), tfidfDB = await _getTFIDFDBForIDAndOrgAndBrainID(id, org, brainid), 
        docsFound = await tfidfDB.query(null, null, metadata => metadata[NEURANET_CONSTANTS.NEURANET_DOCID] == docID), 
        metadata = docsFound.length > 0 ? docsFound[0].metadata : null;
    if (!metadata) LOG.error(`Document to uningest at path ${pathIn} for ID ${id} and org ${org} not found in the TF.IDF DB. Dropping the request.`);
    else await tfidfDB.delete(metadata);
    LOG.info(`TF.IDF DB uningestion of file ${pathIn} for ID ${id} and org ${org} succeeded.`);
}

/**
 * Renames the given file in AI DB and their associated metadatas.
 * @param {string} from The path from
 * @param {string} to The path to
 * @param {string} new_referencelink The new reference link
 * @param {string} id The user ID
 * @param {string} org The user ORG
 * @param {string} brainid The brain ID
 * @throws {Object} Error objects on errors 
 */
exports.renamefile  = async function(from, to, new_referencelink, id, org, brainid) {
    // update TF.IDF DB 
    const docID = aidbfs.getDocID(from), tfidfDB = await _getTFIDFDBForIDAndOrgAndBrainID(id, org, brainid), 
        docsFound = await tfidfDB.query(null, null, metadata => metadata[NEURANET_CONSTANTS.NEURANET_DOCID] == docID), 
        metadata = docsFound.length > 0 ? docsFound[0].metadata : null, 
        new_referencelink_encoded = encodeURI(new_referencelink||aidbfs.getDocID(to)),
        newmetadata = {...(metadata||{}), referencelink: new_referencelink_encoded, fullpath: to}; 
        newmetadata[NEURANET_CONSTANTS.NEURANET_DOCID] = aidbfs.getDocID(to);
    if (!metadata) LOG.error(`Document to rename at path ${from} for ID ${id} and org ${org} not found in the TF.IDF DB. Dropping the request.`);
    else await tfidfDB.update(metadata, newmetadata);
}

/**
 * Flushes the databases to the file system used during ingestion.
 * @param {string} id The user ID
 * @param {string} org The user ORG
 * @param {string} brainid The brain ID
 * @throws Exception on error
 */
exports.flush = async function(id, org, brainid) {
    const tfidfDB = await _getTFIDFDBForIDAndOrgAndBrainID(id, org, brainid); 
    await tfidfDB.flush(); 
}

/**
 * Returns the TF.IDF DB instances for the given ID, ORG and brain IDs. Useful for searching only. 
 * Ingestion should be done via a CMS operation which auto-triggers this module.
 * @param {string} id The user ID
 * @param {string} org The user ORG
 * @param {string} brainid The brain ID
 * @returns The TF.IDF DB instances, throws an exception on error.
 */
exports.getTFIDFDBsForIDAndOrgAndBrainID = async function(id, org, brainid) {
    return [await _getTFIDFDBForIDAndOrgAndBrainID(id, org, brainid)];
}


/**
 * Returns an in-memory TF.IDF DB instances for the given ID, ORG and brain IDs. 
 * @param {string} memid The mem ID for the DB
 * @param {string} brainid The aiapp ID
 * @param {string} brainid The brain ID
 * @returns The TF.IDF DB instances, throws an exception on error.
 */
exports.getInMemTFIDFDB = async function(memid, brainid) {
    const tfidfdb = await aitfidfdb.get_tfidf_db(memid, NEURANET_CONSTANTS.NEURANET_DOCID, 
		NEURANET_CONSTANTS.NEURANET_LANGID, `${NEURANET_CONSTANTS.CONFDIR}/stopwords-iso.json`, undefined, true);
    tfidfdb.aiappid = brainid;
    return tfidfdb;
}

async function _getTFIDFDBForIDAndOrgAndBrainID(id, org, brainid) {
    // TODO: ensure the brainid which is same as aiappid is mapped to the user here as a security check
    const tfidfdb = await aitfidfdb.get_tfidf_db(`${NEURANET_CONSTANTS.AIDBPATH}/${aidbfs.getDBID(id, org, brainid)}/tfidfdb`, 
        NEURANET_CONSTANTS.NEURANET_DOCID, NEURANET_CONSTANTS.NEURANET_LANGID, `${NEURANET_CONSTANTS.CONFDIR}/stopwords-iso.json`);
    tfidfdb.aiappid = brainid;
    return tfidfdb;
}