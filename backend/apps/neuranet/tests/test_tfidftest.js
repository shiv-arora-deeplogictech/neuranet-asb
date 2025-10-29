/**
 * Tests the TF.IDF DB and algorithms within it.
 * 
 * (C) 2023 Tekmonks. All rights reserved.
 */

const fs = require("fs");
const path = require("path");
const serverutils = require(`${CONSTANTS.LIBDIR}/utils.js`);
const aitfidfdb = require(`${NEURANET_CONSTANTS.LIBDIR}/aitfidfdb.js`);

const TEST_ID = "test@tekmonks.com", TEST_ORG = "Tekmonks";

exports.runTestsAsync = async function(argv) {
    if ((!argv[0]) || (argv[0].toLowerCase() != "tfidftest")) {
        LOG.console(`Skipping TF.IDF DB test case, not called.\n`)
        return;
    }
    if (!argv[1]) {LOG.console("Missing test file path/s.\n"); return;} 
    const filesToIngest = argv.slice(1); let query;

    try{
        _clean();
        let createdMetadata, lastFile; for (const [i,fileToIngest] of filesToIngest.entries()) {
            if ((i == filesToIngest.length -1) && (!fs.existsSync(fileToIngest))) { // if last arg not a file then must be a query
                query = fileToIngest; continue; }
            createdMetadata = await _testIngestion(path.resolve(fileToIngest), i+1);  // test ingestion
            if (!createdMetadata) {_testFailed("Ingestion failed for file "+fileToIngest); return false;}
            else _logAndShowMsg("Ingestion succeeded for file "+fileToIngest);
            lastFile = {fileToIngest, index: i+2};
        }
    
        if (query) {
            const queryResult = await _testQuery(query);  // test query
            if (!queryResult) {_testFailed("Query failed."); return false;}
            else _logAndShowMsg(`Query result is ${JSON.stringify(queryResult, null, 2)}.\n`);
            let tfSortedResult; if (queryResult) tfSortedResult = await _testTFSorting(queryResult);
            if (!tfSortedResult) {_testFailed("TF sorting failed."); return false;}
            else _logAndShowMsg(`TF sorted result is ${JSON.stringify(tfSortedResult, null, 2)}.\n`);
        }

        const newMetadata = {...createdMetadata, update_test: true, neuranet_docid: "testdoctest3"};
        const updatedMetadata = await _testUpdate(createdMetadata, newMetadata);  // test update
        if ((!updatedMetadata) || (!updatedMetadata.update_test)) {_testFailed("Update failed."); return false;}

        const deletionResult = await _testDeletion(lastFile.fileToIngest, lastFile.index);  // test deletion
        if (!deletionResult) {_testFailed("Deletion failed."); return false;}

        return true;
    } catch (err) {
        _testFailed(err); return false; } 
    finally {
        await (await _getTFIDFDBForIDAndOrg(TEST_ID, TEST_ORG)).flush(); }    
}

const _logAndShowMsg = (msg, err) => {LOG[err?"error":"info"](msg); LOG.console(msg+"\n");}
const _testFailed = err => {const error=`Error TF.IDF testing failed.${err?" Error was "+err:""}`; _logAndShowMsg(error, true);}
const _clean = async _ => await _getTFIDFDBForIDAndOrg(TEST_ID, TEST_ORG, true);  

async function _testIngestion(pathIn, docindex) {
    LOG.console(`Test case for TF.IDF ingestion called to ingest file ${pathIn}.\n`);

    const tfidfDB = await _getTFIDFDBForIDAndOrg(TEST_ID, TEST_ORG);  
    const metadata = {id: TEST_ID, org: TEST_ORG, fullpath: pathIn}; 
    metadata[NEURANET_CONSTANTS.NEURANET_DOCID] = "testdoc"+docindex;  
    try {await tfidfDB.ingestStream(fs.createReadStream(pathIn, "utf8"), metadata); return metadata;}
    catch (err) {
        LOG.error(`TF.IDF ingestion failed for path ${pathIn} for ID ${TEST_ID} and org ${TEST_ORG} with error ${err}.`); 
        return false;
    }
}

async function _testDeletion(pathIn, docindex) {
    LOG.console(`Test case for TF.IDF deletion called to ingest and then delete file ${pathIn}.\n`);

    const tfidfDB = await _getTFIDFDBForIDAndOrg(TEST_ID, TEST_ORG);  
    const metadata = {id: TEST_ID, org: TEST_ORG, fullpath: pathIn}; 
    const docID = "testdoc"+docindex;
    metadata[NEURANET_CONSTANTS.NEURANET_DOCID] = docID;  
    try {await tfidfDB.ingestStream(fs.createReadStream(pathIn, "utf8"), metadata);}
    catch (err) {
        LOG.error(`TF.IDF ingestion failed for path ${pathIn} for ID ${TEST_ID} and org ${TEST_ORG} with error ${err}.`); 
        return false;
    }
    const deletionResult = await tfidfDB.delete(metadata);
    if (deletionResult[NEURANET_CONSTANTS.NEURANET_DOCID] == docID) return true; else return false;
}

async function _testQuery(query) {
    const tfidfDB = await _getTFIDFDBForIDAndOrg(TEST_ID, TEST_ORG);  
    const queryResult = await tfidfDB.query(query, 3, null, 0, undefined, undefined, true);
    if (!queryResult) return null;
    return queryResult;
}

async function _testTFSorting(queryResults) {
    const tfidfDB = await _getTFIDFDBForIDAndOrg(TEST_ID, TEST_ORG);  
    const sortedForTF = tfidfDB.sortForTF(queryResults);
    return sortedForTF;
}

async function _testUpdate(metadataOld, metadataNew) {
    const tfidfDB = await _getTFIDFDBForIDAndOrg(TEST_ID, TEST_ORG);  
    return await tfidfDB.update(metadataOld, metadataNew);
}

async function _getTFIDFDBForIDAndOrg(id, org, clean) {
    const tfidfDB_ID = `${id}_${org}`, testdir = `${__dirname}/temp/tfidf_db/${tfidfDB_ID}`;
    if (clean) {
        serverutils.rmrf(testdir);  // clean it for testing
        fs.mkdirSync(testdir, {recursive: true});
    }
    const tfidfdb = await aitfidfdb.get_tfidf_db(testdir, NEURANET_CONSTANTS.NEURANET_DOCID, 
        NEURANET_CONSTANTS.NEURANET_LANGID, `${NEURANET_CONSTANTS.CONFDIR}/stopwords-iso.json`);
    return tfidfdb;
}