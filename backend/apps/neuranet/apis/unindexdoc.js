/**
 * Unindexes the document from the backend vector store knowledge base. 
 * The DB id can be used to split the backend into multiple vector stores, 
 * thus, building multiple knowledge bases. Saves the incoming document to
 * a new UTF8 text file at <cms_root_for_the_user>/dynamic.
 * 
 * API Request
 *  filename - the file to uningest
 *  id - the user's ID or the AI DB id
 *  org - the user's org
 *  aiappid - the AI app ID for the user
 *  cmspath - Optional: the path to the CMS file entry, if skipped the file is deleted from the "uploads" folder
 *  start_transaction - Optional: If used indicates a start to a mass load transaction
 *  stop_transaction - Optional: If used indicates a stop to a mass load transaction
 *  continue_transaction - Optional: If used indicates a continuation of a mass load transaction
 *  __forceDBFlush - Optional: if true, forces the DBs to flush to the filesystem
 * 
 * API Response
 *  result - true or false
 *  reason - set to one of the reasons if result is false, on true it is set to 'ok'
 * 
 * (C) 2023 TekMonks. All rights reserved.
 */

const utils = require(`${CONSTANTS.LIBDIR}/utils.js`);
const blackboard = require(`${CONSTANTS.LIBDIR}/blackboard.js`);
const aiapp = require(`${NEURANET_CONSTANTS.LIBDIR}/aiapp.js`);
const aidbfs = require(`${NEURANET_CONSTANTS.LIBDIR}/aidbfs.js`);
const indexdoc = require(`${NEURANET_CONSTANTS.APIDIR}/indexdoc.js`);
const fileindexer = require(`${NEURANET_CONSTANTS.LIBDIR}/fileindexer.js`);
const brainhandler = require(`${NEURANET_CONSTANTS.LIBDIR}/brainhandler.js`);

const REASONS = {INTERNAL: "internal", OK: "ok", VALIDATION:"badrequest", LIMIT: "limit"};

exports.doService = async (jsonReq, _servObject, _headers, _url) => {
	if (!validateRequest(jsonReq)) {LOG.error("Validation failure."); return {reason: REASONS.VALIDATION, ...CONSTANTS.FALSE_RESULT};}

	const {id, org, aiappid, filename, cmspath, __forceDBFlush} = jsonReq;
	LOG.debug(`Got unindex document request from ID ${id}. Incoming filename is ${filename}.`);

	const _areCMSPathsSame = (cmspath1, cmspath2) => 
		(utils.convertToUnixPathEndings("/"+cmspath1, true) == utils.convertToUnixPathEndings("/"+cmspath2, true));
	const aiappThis = await aiapp.getAIApp(id, org, aiappid), 
		finalCMSPath = `${cmspath||aiappThis.api_uploads_cms_path||indexdoc.DEFAULT_DYNAMIC_FILES_FOLDER}/${filename}`;
	try {
		const aidbFileProcessedPromise = new Promise(resolve => blackboard.subscribe(NEURANET_CONSTANTS.NEURANETEVENT, 
			message => { if (message.type == NEURANET_CONSTANTS.EVENTS.AIDB_FILE_PROCESSED && 
				_areCMSPathsSame(message.cmspath, finalCMSPath)) resolve(message); }));
		const extrainfo = brainhandler.createExtraInfo(id, org, aiappid);
		extrainfo[fileindexer.DO_NOT_FLUSH_AIDB] = true;	// unless told to flush we do not do it, speeds up mass unindexing
		if (!(await fileindexer.deleteFileFromCMSRepository(id, org, finalCMSPath, extrainfo))) {
			LOG.error(`CMS error deleting document for request ${JSON.stringify(jsonReq)}`); 
			return {reason: REASONS.INTERNAL, ...CONSTANTS.FALSE_RESULT};
		}
		const aidbUningestionResult = await aidbFileProcessedPromise;
		if (!aidbUningestionResult.result) {
			LOG.error(`AI library error unindexing document for request ${JSON.stringify(jsonReq)}`); 
			return {reason: REASONS.INTERNAL, ...CONSTANTS.FALSE_RESULT};
		} else {
			if (__forceDBFlush) await aidbfs.flush(id, org, aiappid);
			return {reason: REASONS.OK, ...CONSTANTS.TRUE_RESULT};
		}
	} catch (err) {
		LOG.error(`Unable to delete the corresponding file from the CMS. Failure error is ${err}.`);
		return {reason: REASONS.INTERNAL, ...CONSTANTS.FALSE_RESULT};
	}
}

const validateRequest = jsonReq => (jsonReq && jsonReq.filename && jsonReq.id && jsonReq.org && jsonReq.aiappid);
