/**
 * Will index files including XBin documents in and out of the AI databases.
 * This should be the only class used for ingestion, except direct file operations
 * to XBin via XBin REST or JS APIs.
 * 
 * Bridge between drive documents including XBin and Neuranet knowledgebases.
 * 
 * Listens to local XBin cluster events - so any file op will be emitted to the
 * entire local cluster and will update (and sync) all local AI DBs - independently.
 * 
 * (C) 2023 Tekmonks Corp. All rights reserved.
 * License: See enclosed LICENSE file.
 */

const XBIN_CONSTANTS = NEURANET_CONSTANTS.XBIN_CONSTANTS;

const path = require("path");
const crypto = require("crypto");
const mustache = require("mustache");
const cms = require(`${XBIN_CONSTANTS.LIB_DIR}/cms.js`);
const aiapp = require(`${NEURANET_CONSTANTS.LIBDIR}/aiapp.js`);
const login = require(`${NEURANET_CONSTANTS.APIDIR}/login.js`);
const blackboard = require(`${CONSTANTS.LIBDIR}/blackboard.js`);
const aidbfs = require(`${NEURANET_CONSTANTS.LIBDIR}/aidbfs.js`);
const uploadfile = require(`${XBIN_CONSTANTS.API_DIR}/uploadfile.js`);
const deletefile = require(`${XBIN_CONSTANTS.API_DIR}/deletefile.js`);
const renamefile = require(`${XBIN_CONSTANTS.API_DIR}/renamefile.js`);
const downloadfile = require(`${XBIN_CONSTANTS.API_DIR}/downloadfile.js`);
const brainhandler = require(`${NEURANET_CONSTANTS.LIBDIR}/brainhandler.js`);
const textextractor = require(`${NEURANET_CONSTANTS.LIBDIR}/textextractor.js`);
const neuranetutils = require(`${NEURANET_CONSTANTS.LIBDIR}/neuranetutils.js`);
const timed_expiry_cache = require(`${CONSTANTS.LIBDIR}/timedcache.js`).newcache(NEURANET_CONSTANTS.CONF.fastcache_timeout);

let conf;
const DEFAULT_MINIMIMUM_SUCCESS_PERCENT = 0.5;

exports.initSync = _ => {
    conf = require(`${NEURANET_CONSTANTS.CONFDIR}/fileindexer.json`); 
    confRendered = mustache.render(JSON.stringify(conf), {APPROOT: NEURANET_CONSTANTS.APPROOT.split(path.sep).join(path.posix.sep)}); 
    conf = JSON.parse(confRendered);
    if (!conf.enabled) return;  // file indexer is disabled
    
    const bboptions = {}; bboptions[blackboard.LOCAL_ONLY] = true;  // only operate on local CMS' events
    if (!NEURANET_CONSTANTS.CONF.disable_xbin) blackboard.subscribe(XBIN_CONSTANTS.XBINEVENT, message => _handleFileEvent(message), bboptions);
    if (!NEURANET_CONSTANTS.CONF.disable_private_cms) blackboard.subscribe(NEURANET_CONSTANTS.NEURANETEVENT, message => _handleFileEvent(message), bboptions);
    cms.setLoginModule(login); // we will be using Neuranet's login module
    _initPluginsAsync(); 
}

/**
 * Adds the given file to the backend CMS repository. Will also issue new file event so the
 * file is then ingested into the backend AI databases, unless told to otherwise.
 * 
 * @param {string} id The user ID of the user ingesting this file.
 * @param {string} org The org of the user ID of the user ingesting this file.
 * @param {object} contentsOrStream File contents of read stream for the file. If contents then must be a buffer.
 * @param {string} cmspath The cms path at which to upload the file.
 * @param {string} comment The file's comment.
 * @param {object} extrainfo Extrainfo object associated with this upload.
 * @param {boolean} noaievent If true, the file is added to CMS without further AI processing 
 * @returns {object} Returns result of the format {result: true|false} on success or on failure.
 */
exports.addFileToCMSRepository = async function(id, org, contentsOrStream, cmspath, comment, extrainfo, noaievent=false) {
    const xbinResult = await uploadfile.uploadFile(id, org, contentsOrStream, cmspath, comment, extrainfo, noaievent);
    if (xbinResult) return xbinResult.result; else {
        LOG.error(`Error adding file ${cmspath} to the CMS repository, distribued job failed probably.`); return false; }
}

/**
 * Reads the given file from the backend CMS repository. 
 * 
 * @param {string} id The user ID of the user ingesting this file.
 * @param {string} org The org of the user ID of the user ingesting this file.
 * @param {string} fullpath The full path of the file
 * @param {object} extrainfo Extrainfo object associated with this upload.
 * @returns {object} Returns text contents of the file.
 */
exports.getTextContents = async function(id, org, fullpath, extrainfo) {
    const cmspath = cms.getCMSRootRelativePath({xbin_id: id, xbin_org: org}, fullpath, extrainfo);
    const indexer = await _getFileIndexer(fullpath, id, org, cmspath, extrainfo);
    return indexer.getTextContents();
}

/**
 * Removes the given file from the backend CMS repository. Will also issue delete file event so the
 * file is then uningested into the backend AI databases, unless told to otherwise.
 * 
 * Running it as a cluster job means file/io is only once, since XBin FS is shared, it should be same
 * for all instances. If `noaievent` is set to false, then AI events will ensure all local cluster AI
 * instances update themselves regardless (AI DBs take care of cluster targeting for deletes and updates).
 * 
 * @param {string} id The user ID of the user ingesting this file.
 * @param {string} org The org of the user ID of the user ingesting this file.
 * @param {string} cmspath The cms path at which to delete the file.
 * @param {object} extrainfo Extrainfo object associated with this upload.
 * @param {noaievent} boolean If true, the file is added to CMS without further AI processing 
 * @returns true on success or false on failure.
 */
exports.deleteFileFromCMSRepository = async function(id, org, cmspath, extrainfo, noaievent=false) {
    const xbinResult = await deletefile.deleteFile({xbin_id: id, xbin_org: org}, cmspath, extrainfo, noaievent)
    if (xbinResult) return xbinResult.result; else {
        LOG.error(`Error deleting file ${cmspath} from the CMS repository, distribued job failed probably.`); return false; }
}

/**
 * Renames the given file from the backend CMS repository. Will also issue renamed file event so the
 * file is then uningested into the backend AI databases, unless told to otherwise.
 * 
 * Running it as a cluster job means file/io is only once, since XBin FS is shared, it should be same
 * for all instances. If `noaievent` is set to false, then AI events will ensure all local cluster AI
 * instances update themselves regardless (AI DBs take care of cluster targeting for deletes and updates).
 * 
 * @param {string} id The user ID of the user ingesting this file.
 * @param {string} org The org of the user ID of the user ingesting this file.
 * @param {string} cmspathFrom The cms path from which to move the file.
 * @param {string} cmspathTo The cms path to which to move the file.
 * @param {object} extrainfo Extrainfo object associated with this upload.
 * @param {noaievent} boolean If true, the file is added to CMS without further AI processing 
 * @returns true on success or false on failure.
 */
exports.renameFileFromCMSRepository = async function(id, org, cmspathFrom, cmspathTo, extrainfo, noaievent=false) {
    const xbinResult = await renamefile.renameFile({xbin_id: id, xbin_org: org}, cmspathFrom, cmspathTo, extrainfo, true);
    if (xbinResult) return xbinResult.result; else {
        LOG.error(`Error renaming file ${cmspath} in the CMS repository, distribued job failed probably.`); return false; }
}

/** Flag to not flush AI DBs after the request */
exports.DO_NOT_FLUSH_AIDB = "doNotFlushAIDB";

async function _handleFileEvent(message) {
    const _awaitPromisePublishFileEvent = async (promise, fullpath, type, id, org, extraInfo) => {  // this is mostly to inform listeners about file being processed events
        const cmspath = await cms.getCMSRootRelativePath({xbin_id: id, xbin_org: org}, fullpath, extraInfo);
        // we have started processing a file
        blackboard.publish(NEURANET_CONSTANTS.NEURANETEVENT, {type: NEURANET_CONSTANTS.EVENTS.AIDB_FILE_PROCESSING, 
            result: true, subtype: type, id, org, path: fullpath, cmspath, extraInfo});
        const result = await promise;   // wait for it to complete
        // we have finished processing this file
        blackboard.publish(NEURANET_CONSTANTS.NEURANETEVENT, {type: NEURANET_CONSTANTS.EVENTS.AIDB_FILE_PROCESSED, 
            path: fullpath, result: result?result.result:false, subtype: type, id, org, cmspath, extraInfo});
    }

    const _isDuplicateEvent = message => {
        const hashAlgo = crypto.createHash("md5"); 
        hashAlgo.update(path.resolve(message.path||message.from) + message.id + message.org + message.type);
        const hash = "_neuranet_fileindexer"+hashAlgo.digest("hex"); 
        if (!timed_expiry_cache.get(hash)) {timed_expiry_cache.set(hash, "present"); return false;}
        else return true;
    }

    if (message.extraInfo && brainhandler.isAIAppBeingEdited(message.extraInfo)) return;  // we don't handle AI events for edit AI of apps

    // only the testing classes currently use NEURANET_CONSTANTS.EVENTS.* as they directly upload to the
    // Neuranet drive instead of CMS
    const _isNeuranetFileCreatedEvent = message => message.type == XBIN_CONSTANTS.EVENTS.FILE_CREATED ||
        message.type == NEURANET_CONSTANTS.EVENTS.FILE_CREATED,
        _isNeuranetFileDeletedEvent = message => message.type == XBIN_CONSTANTS.EVENTS.FILE_DELETED ||
            message.type == NEURANET_CONSTANTS.EVENTS.FILE_DELETED,
        _isNeuranetFileRenamedEvent = message => message.type == XBIN_CONSTANTS.EVENTS.FILE_RENAMED ||
            message.type == NEURANET_CONSTANTS.EVENTS.FILE_RENAMED,
        _isNeuranetFileModifiedEvent = message => message.type == XBIN_CONSTANTS.EVENTS.FILE_MODIFIED ||
            message.type == NEURANET_CONSTANTS.EVENTS.FILE_MODIFIED,
        _isNeuranetEvent = (!message.isDirectory) && (_isNeuranetFileCreatedEvent || _isNeuranetFileDeletedEvent || _isNeuranetFileRenamedEvent || _isNeuranetFileModifiedEvent);

    if (!_isNeuranetEvent) return;  // not something we can handle
    if (_isDuplicateEvent(message)) return; // handle only one event per file

    if (_isNeuranetFileCreatedEvent(message)) 
        _awaitPromisePublishFileEvent(_ingestfile(path.resolve(message.path), message.id, message.org, message.lang, message.extraInfo), 
            message.path, NEURANET_CONSTANTS.FILEINDEXER_FILE_PROCESSED_EVENT_TYPES.INGESTED, message.id, message.org, message.extraInfo);
    else if (_isNeuranetFileDeletedEvent(message)) 
        _awaitPromisePublishFileEvent(_uningestfile(path.resolve(message.path), message.id, message.org, message.extraInfo), 
            message.path, NEURANET_CONSTANTS.FILEINDEXER_FILE_PROCESSED_EVENT_TYPES.UNINGESTED, message.id, message.org, message.extraInfo);
    else if (_isNeuranetFileRenamedEvent(message)) 
        _awaitPromisePublishFileEvent(_renamefile(path.resolve(message.from), path.resolve(message.to), message.id, 
            message.org, message.extraInfo), message.to, NEURANET_CONSTANTS.FILEINDEXER_FILE_PROCESSED_EVENT_TYPES.RENAMED, message.id, 
            message.org, message.extraInfo);
    else if (_isNeuranetFileModifiedEvent(message)) {
        await _uningestfile(path.resolve(message.path), message.id, message.org, message.extraInfo);
        _awaitPromisePublishFileEvent(_ingestfile(path.resolve(message.path), message.id, message.org, message.lang, message.extraInfo), 
            message.path, NEURANET_CONSTANTS.FILEINDEXER_FILE_PROCESSED_EVENT_TYPES.MODIFIED, message.id, message.org, message.extraInfo);
    }
}

async function _ingestfile(pathIn, id, org, lang, extraInfo) {
    const cmspath = await cms.getCMSRootRelativePath({xbin_id: id, xbin_org: org}, pathIn, extraInfo);
    const indexer = await _getFileIndexer(pathIn, id, org, cmspath, extraInfo, lang), 
        filePluginResult = await _searchForFilePlugin(indexer);
    if (filePluginResult.plugin) return {result: await filePluginResult.plugin.ingest(indexer)};
    if (filePluginResult.error) return {result: false, cause: "Plugin validation failed."}
    else {const result = await indexer.addFileToAI(); await indexer.end(); return result;}
}

async function _uningestfile(pathIn, id, org, extraInfo) {
    const cmspath = await cms.getCMSRootRelativePath({xbin_id: id, xbin_org: org}, pathIn, extraInfo);
    const indexer = await _getFileIndexer(pathIn, id, org, cmspath, extraInfo), 
        filePluginResult = await _searchForFilePlugin(indexer);
    if (filePluginResult.plugin) return {result: await filePluginResult.plugin.uningest(indexer)};
    if (filePluginResult.error) return {result: false, cause: "Plugin validation failed."}
    else {const result = await indexer.removeFileFromAI(cmspath); await indexer.end(); return result;}
}

async function _renamefile(from, to, id, org, extraInfo) {
    const cmspathFrom = await cms.getCMSRootRelativePath({xbin_id: id, xbin_org: org}, from, extraInfo);
    const cmspathTo = await cms.getCMSRootRelativePath({xbin_id: id, xbin_org: org}, to, extraInfo);
    const indexer = await _getFileIndexer(from, id, org, cmspathFrom, extraInfo), filePluginResult = await _searchForFilePlugin(indexer);
    indexer.filepathTo = to; indexer.cmspathTo = cmspathTo;
    if (filePluginResult.plugin) return {result: await filePluginResult.plugin.rename(indexer)};
    if (filePluginResult.error) return {result: false, cause: "Plugin validation failed."}
    else {const result = await indexer.renameFileToAI(cmspathFrom, cmspathTo); await indexer.end(); return result;}
}

async function _initPluginsAsync() {
    for (const file_plugin of conf.file_handling_plugins) {
        const pluginThis = NEURANET_CONSTANTS.getPlugin(file_plugin);
        if (pluginThis.initAsync) await pluginThis.initAsync();
    }
}

async function _searchForFilePlugin(fileindexerForFile) {
    for (const file_plugin of conf.file_handling_plugins) {
        const pluginThis = NEURANET_CONSTANTS.getPlugin(file_plugin);
        try {if (await pluginThis.canHandle(fileindexerForFile)) return {plugin: pluginThis, result: true, error: null};}
        catch (err) { LOG.error(`Plugin validation failed for ${file_plugin}. The error was ${err}`);
            return {error: err, result: false}}
    }

    return {error: null, result: false};
}

async function _getFileIndexer(pathIn, id, org, cmspath, extraInfo, lang) {
    const aiappid = await aiapp.getAppID(id, org, extraInfo);
    return {
        filepath: pathIn, id, org, lang, minimum_success_percent: DEFAULT_MINIMIMUM_SUCCESS_PERCENT, 
        cmspath, aiappid, extrainfo: extraInfo,
        addFileToCMSRepository: async (contentBufferOrReadStream, cmspath, comment, noaievent) =>
            await exports.addFileToCMSRepository(id, org, contentBufferOrReadStream, 
                cmspath, comment, extraInfo, noaievent),
        deleteFileFromCMSRepository: async (cmspath, noaievent) => 
            await exports.deleteFileFromCMSRepository(id, org, cmspath, extraInfo, noaievent),
        renameFileFromCMSRepository: async (cmspath, cmspathTo, noaievent) => 
            await exports.renameFileFromCMSRepository(id, org, cmspath, cmspathTo, extraInfo, noaievent),
        getTextReadstream: async function(overridePath) {
            const pathToRead = overridePath||pathIn;
            const inputStream = downloadfile.getReadStream(pathToRead, false);
            const readStream = await textextractor.extractTextAsStreams(inputStream, pathToRead);
            return readStream;
        },
        getReadstream: async function(overridePath) {return await this.getTextReadstream(overridePath)},
        getReadBuffer: async function(overridePath) {
            const pathToRead = overridePath||pathIn;
            const readBuffer = await textextractor.extractTextAsBuffer(pathToRead);
            return readBuffer;
        },
        getTextContents: async function(encoding) {
            try {
                const contents = await neuranetutils.readFullFile(await this.getTextReadstream(), encoding);
                return contents;
            } catch (err) {
                LOG.error(`CRITICAL: File content extraction failed for ${this.filepath}.`);
                return null;
            }
        },
        getContents: async function(encoding) { return await this.getTextContents(encoding)},
        start: function(){},
        end: function(){if (extraInfo?.[module.exports.DO_NOT_FLUSH_AIDB]) return; else aidbfs.flush(id, org, aiappid);},
        flush: async function() { try {await aidbfs.flush(id, org, aiappid); return true;} catch (err) {
            LOG.error(`Error flushing AI databases. The error is ${err}`); return false;} },
        //addfile, removefile, renamefile - all follow the same high level logic
        addFileToAI: async function(cmsPathThisFile=this.cmspath, langFile=this.lang, metadata) {
            try {
                const fullPath = await cms.getFullPath({xbin_id: id, xbin_org: org}, cmsPathThisFile, extraInfo);
                
                // update AI databases
                const aiDBIngestResult = await aidbfs.ingestfile(fullPath, cmsPathThisFile, id, org, aiappid, 
                    langFile, _=>this.getTextReadstream(fullPath), metadata||brainhandler.getMetadata(this.extrainfo));  // update AI databases
                if (aiDBIngestResult?.result) return true; else return false;
            } catch (err) {
                LOG.error(`Error writing file ${cmsPathThisFile} for ID ${id} and org ${org} due to ${err}.`);
                return false;
            }
        },
        removeFileFromAI: async function(cmsPathFile=this.cmspath) {
            try {
                const fullPath = await cms.getFullPath({xbin_id: id, xbin_org: org}, cmsPathFile, extraInfo);
                const aiDBUningestResult = await aidbfs.uningestfile(fullPath, id, org, aiappid);
                if (aiDBUningestResult?.result) return CONSTANTS.TRUE_RESULT; else return CONSTANTS.FALSE_RESULT;
            } catch (err) {
                LOG.error(`Error deleting file ${cmsPathFile} for ID ${id} and org ${org} due to ${err}.`);
                return CONSTANTS.FALSE_RESULT;
            }
        },
        renameFileToAI: async function(cmsPathFrom=this.cmspath, cmsPathTo=this.cmspathTo) {
            try {
                const fullPathFrom = await cms.getFullPath({xbin_id: id, xbin_org: org}, cmsPathFrom, extraInfo);
                const fullPathTo = await cms.getFullPath({xbin_id: id, xbin_org: org}, cmsPathTo, extraInfo);
                const aiDBRenameResult = await aidbfs.renamefile(fullPathFrom, fullPathTo, cmsPathTo, id, org, aiappid);
                    if (aiDBRenameResult?.result) return CONSTANTS.TRUE_RESULT; else return CONSTANTS.FALSE_RESULT;
            } catch (err) {
                LOG.error(`Error renaming file ${cmsPathFrom} for ID ${id} and org ${org} due to ${err}.`);
                return CONSTANTS.FALSE_RESULT;
            }
        }
    }
}
