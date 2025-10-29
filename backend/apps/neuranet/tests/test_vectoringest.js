/**
 * Tests the vector DB and algorithms within it.
 * 
 * (C) 2023 Tekmonks. All rights reserved.
 */

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const assert = require("assert").strict;
const csvparser = require("papaparse");
const aivectordb = require(`${NEURANET_CONSTANTS.LIBDIR}/aivectordb.js`);
const aivectordb_test_path = `${__dirname}/vector_db/test@tekmonks.com_Tekmonks`;

exports.runTestsAsync = async function(argv) {
    if ((!argv[0]) || (argv[0].toLowerCase() != "vectoringest")) {
        LOG.console(`Skipping vector DB ingestion test case, not called.\n`)
        return;
    }
    if (!argv[1]) {
        LOG.console("Missing test file path.\n");
        return;
    } 

    LOG.console(`Test case for VectorDB ingestion called to ingest file ${argv[1]}.\n`);

    const vectorDB = await aivectordb.get_vectordb(aivectordb_test_path, undefined, "neuranet_docid");
    const fileToParse = path.resolve(argv[1]); 
    const recordToDelete = await _ingestCVSFile(vectorDB, fileToParse, 2);

    if (recordToDelete) {
        _log_info(`Trying to delete record number 2, with text \n${recordToDelete.text}`);
        const deletionResult = vectorDB.delete(recordToDelete.vector, recordToDelete.metadata);

        if (deletionResult) _log_info(`Deletion successful.`); else _log_error(`Deletion failed.`);
    }

    if (recordToDelete) {
        _log_info(`Trying to re-add and then update record number 2, with text \n${recordToDelete.text}`);
        const creationResult = await vectorDB.create(recordToDelete.vector, recordToDelete.metadata, recordToDelete.text);
        assert.strictEqual(recordToDelete.vector, creationResult, "Created vector not the same as requested.");
        _log_info(`Reinsertion successful.`);

        const updatedMetadata = {...recordToDelete.metadata, update_tested: true};
        const udpateResult = await vectorDB.update(creationResult, recordToDelete.metadata, updatedMetadata, recordToDelete.text);
        assert.strictEqual(creationResult, udpateResult, "Updated vector not the same as requested.");
        _log_info(`Update successful.`);

        const readResult = await vectorDB.read(udpateResult, updatedMetadata);
        assert.strictEqual(readResult.metadata, updatedMetadata, "Re-read metadata not the same as requested.");
        _log_info(`Read successful.`);
    }

    await vectorDB.flush_db(); 

    return true;
}

function _ingestCVSFile(vectorDB, fileToParse, returnRecordNum=2) {
    const _getFileReadStream = path => path.toLowerCase().endsWith(".gz") ?
        fs.createReadStream(fileToParse).pipe(zlib.createGunzip()) : fs.createReadStream(fileToParse);

    let numRecordsProcessed = 0, numRecordsIngested = 0, waiting_ingestions = 0, retRecord;
    return new Promise(resolve => csvparser.parse(_getFileReadStream(fileToParse), {
        step: async function(results, _parser) { 
            waiting_ingestions++;
            const csvLine = results.data;

            let vectorThisResult; if (csvLine.combined_info_search) 
                try {vectorThisResult = JSON.parse(csvLine.combined_info_search)} catch (err) {};
            if (vectorThisResult && csvLine.overview && csvLine.id && (await vectorDB.create(vectorThisResult, 
                    {link: csvLine.homepage, title: csvLine.title, neuranet_docid: csvLine.id}, csvLine.overview)) == vectorThisResult) {
                _log_info(`${++numRecordsProcessed} --- ${csvLine.title} - Ingested.`); numRecordsIngested++;
                if (returnRecordNum == numRecordsProcessed) retRecord = {vector: vectorThisResult, metadata: {link: csvLine.homepage, title: csvLine.title, neuranet_docid: csvLine.id}, text: csvLine.overview};
            } else _log_info(`${++numRecordsProcessed} --- ${csvLine.title} - Not Ingested As ${vectorThisResult?"Overview or ID missing":"Vector Parse Failed"}.`);
            waiting_ingestions--;
        },
        header: true,
        dynamicTyping: true,
        complete: _ => {
            const completionTimer = setInterval(async _=> {if (waiting_ingestions == 0) {
                clearInterval(completionTimer);
                await vectorDB.flush_db(); 
                _log_info(`Completed successfully ${numRecordsProcessed} records. Total ingested ${numRecordsIngested}. Total errors ${numRecordsProcessed - numRecordsIngested}.`);
                resolve(retRecord);
            }}, 100);
        },
        error: error => {_log_error("Error: "+error); resolve();}
    }));
}

const _log_info = msg => {LOG.console(msg+"\n"); LOG.info(msg);};
const _log_error = msg => {LOG.console(msg+"\n"); LOG.error(msg);};