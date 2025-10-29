/**
 * Plugin for Neuranet's built in vector DB.
 * 
 * (C) 2022 TekMonks. All rights reserved.
 * License: See the enclosed LICENSE file.
 */

const aivectordb = require(`${__dirname}/aivectordb.js`);
const aiapp = require(`${NEURANET_CONSTANTS.LIBDIR}/aiapp.js`);
const aidbfs = require(`${NEURANET_CONSTANTS.LIBDIR}/aidbfs.js`);
const embedding = require(`${NEURANET_CONSTANTS.LIBDIR}/embedding.js`);

const MODEL_DEFAULT = "embedding-openai";

/** Inits the plugin, must be called */
exports.init = function() {aivectordb.init()};

/** The DB plugin name */
exports.name = "Vector DB"; 

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
    const aiappThis = await aiapp.getAIApp(id, org, brainid, true);
    const aiModelToUseForEmbeddings = aiappThis.default_embeddings_model || MODEL_DEFAULT;
    const embeddingsGenerator = async text => {
        const response = await embedding.createEmbeddingVector(id, org, brainid, text, aiModelToUseForEmbeddings); 
        if (response.reason != embedding.REASONS.OK) return null;
        else return response.embedding;
    }
    let vectordb; try { vectordb = await _getVectorDBForIDAndOrgAndBrainID(id, org, brainid, embeddingsGenerator) } catch(err) { 
        LOG.error(`Can't instantiate the vector DB ${vectorDB_ID} for ID ${id} and org ${org}. Unable to continue.`);
        return {reason: REASONS.INTERNAL, ...CONSTANTS.FALSE_RESULT}; 
    }

    const aiModelObjectForEmbeddings = await aiapp.getAIModel(aiModelToUseForEmbeddings, undefined, id, org, brainid);
    try { 
        const chunkSize = aiModelObjectForEmbeddings.vector_chunk_size[lang] || aiModelObjectForEmbeddings.vector_chunk_size["*"],
            split_separators = aiModelObjectForEmbeddings.split_separators[lang] || aiModelObjectForEmbeddings.split_separators["*"];
        await vectordb.ingeststream(metadata, stream, aiModelObjectForEmbeddings.encoding, 
            chunkSize, split_separators, aiModelObjectForEmbeddings.overlap);
    } catch (err) { 
        LOG.error(`Vector ingestion failed for ID ${id} and org ${org} with error ${err}.`); 
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
    let vectordb; try { vectordb = await _getVectorDBForIDAndOrgAndBrainID(id, org, brainid); } catch(err) { 
        LOG.error(`Can't instantiate the vector DB ${vectordb} for ID ${id} and org ${org}. Unable to continue.`); 
        throw err;
    }
    const docID = aidbfs.getDocID(pathIn), 
        vectorsFound = await vectordb.query(null, 1, 0, metadata => metadata[NEURANET_CONSTANTS.NEURANET_DOCID] == docID, true), 
        metadata = vectorsFound.length > 0 ? vectorsFound[0].metadata : null;
    await vectordb.uningest(metadata);
    LOG.info(`Vector DB uningestion of file ${pathIn} for ID ${id} and org ${org} succeeded.`);
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
    let vectordb; try { vectordb = await _getVectorDBForIDAndOrgAndBrainID(id, org, brainid); } catch(err) { 
        LOG.error(`Can't instantiate the vector DB ${vectordb} for ID ${id} and org ${org}. Unable to continue.`); 
        throw err;
    }
    const docID = aidbfs.getDocID(from), 
        vectorsFound = await vectordb.query(null, 1, 0, metadata => metadata[NEURANET_CONSTANTS.NEURANET_DOCID] == docID, true), 
        metadata = vectorsFound.length > 0 ? vectorsFound[0].metadata : null,
        new_referencelink_encoded = encodeURI(new_referencelink||aidbfs.getDocID(to)),
        newmetadata = {...(metadata||{}), referencelink: new_referencelink_encoded, fullpath: to}; 
        newmetadata[NEURANET_CONSTANTS.NEURANET_DOCID] = aidbfs.getDocID(to);
    if (!metadata) LOG.error(`Document to rename at path ${from} for ID ${id} and org ${org} not found in the vector DB. Dropping the request.`);
    else await vectordb.update(metadata, newmetadata);
}

/**
 * Flushes the databases to the file system used during ingestion.
 * @param {string} id The user ID
 * @param {string} org The user ORG
 * @param {string} brainid The brain ID
 * @throws Exception on error
 */
exports.flush = _ => {} // vector DB doesn't need flushing

/**
 * Returns the Vector DB instances for the given ID, ORG, brain ID and embeddings generator. 
 * Useful for searching only. Ingestion should be done via a CMS operation which 
 * auto-triggers this module.
 * @param {string} id The user ID
 * @param {string} org The user ORG
 * @param {string} brainid The brain ID
 * @param {function} embeddingsGenerator The vector embeddings generator to use. Function that takes text and returns a vector of floats.
 * @returns The Vector DB instances, throws an exception on error.
 */
exports.getVectorDBsForIDAndOrgAndBrainID = async function (id, org, brainid, embeddingsGenerator) {
    return [await _getVectorDBForIDAndOrgAndBrainID(id, org, brainid, embeddingsGenerator)];
}


/**
 * Returns the Vector DB instances for the temporary path. Useful for searching only.
 * @param {string} temppath Temporary path. Must be a valid folder.
 * @param {function} embeddingsGenerator The vector embeddings generator to use. Function that takes text and returns a vector of floats.
 * @returns The Vector DB instances, throws an exception on error.
 */
exports.getTempVectorDB = async function (temppath, brainid, embeddingsGenerator) {
    const vectordb = await aivectordb.get_vectordb(temppath, embeddingsGenerator, NEURANET_CONSTANTS.NEURANET_DOCID);
    vectordb.aiappid = brainid;
    return vectordb;
}

async function _getVectorDBForIDAndOrgAndBrainID(id, org, brainid, embeddingsGenerator) {
    // TODO: ensure the brainid which is same as aiappid is mapped to the user here as a security check
    const vectordb = await aivectordb.get_vectordb(`${NEURANET_CONSTANTS.AIDBPATH}/${aidbfs.getDBID(id, org, brainid)}/vectordb`, 
        embeddingsGenerator, NEURANET_CONSTANTS.NEURANET_DOCID);
    vectordb.aiappid = brainid;
    return vectordb;
}