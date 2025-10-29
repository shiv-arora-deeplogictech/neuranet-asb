/**
 * Tests the vector and TF.IDF DB ingestions and algorithms within them.
 * 
 * Input must be fully qualified paths to the files to ingest.
 * 
 * (C) 2023 Tekmonks. All rights reserved.
 */

const path = require("path");
const fspromises = require("fs").promises;
const rest = require(`${CONSTANTS.LIBDIR}/rest.js`);
const conf = require(`${__dirname}/conf/testing.json`);
const dblayer = require(`${NEURANET_CONSTANTS.LIBDIR}/dblayer.js`);
const indexdoc = require(`${NEURANET_CONSTANTS.APIDIR}/indexdoc.js`);

const TEST_ID = "test@tekmonks.com", TEST_ORG = "Tekmonks", TEST_APP = conf.aiapp;

exports.runTestsAsync = async function(argv) {
    if ((!argv[0]) || (argv[0].toLowerCase() != "aiindex")) {
        LOG.console(`Skipping AI DB index test case, not called.\n`)
        return;
    }

    if (!argv[1]) { LOG.console("Missing test file/s path/s.\n"); return; }
    let userObj = argv.pop();
    if (typeof userObj === 'object') { const userConf = require(`${__dirname}/conf/testing.json`)[userObj.user];
        userObj = { ...userConf, aiappid: userObj["aiapp"] };} else { argv.push(userObj); userObj = undefined; }
        
    let serialIngestion = argv.pop(); if (typeof serialIngestion !== 'boolean') { argv.push(serialIngestion); serialIngestion = undefined; }
    
    const lastArg = argv[argv.length-1];
    if (lastArg?.toLowerCase() == "servertest") {
        process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = 0;
        argv = argv.slice(0, -1);
    }
    const filesToTest = argv.slice(1);

    LOG.console(`Test case for AI DB indexing called to index the files ${filesToTest.join(", ")}.\n`);

    await dblayer.initDBAsync();    // we need DB before anything else happens
    
    let finalResults = 0; 
    const indexFileAPIRequest = async jsonReq => {
        const result = lastArg?.toLowerCase() == "servertest" ? 
            (await rest[conf.protocol.toLowerCase()=="https"?"postHttps":"post"](conf.host, conf.port, 
                "/apps/neuranet/indexdoc", conf.headers, jsonReq, {rejectUnauthorized: false})).data : 
            await indexdoc.doService(jsonReq);
        if (result?.result) {
            const successMsg = `Test indexing of ${jsonReq.filename} succeeded.\n`;
            LOG.info(successMsg); LOG.console(successMsg); finalResults++;
        } else {
            const errorMsg = `Test indexing of ${jsonReq.filename} failed.\n`;
            LOG.error(errorMsg); LOG.console(errorMsg);
        }
    };

    const  indexingPromises = [], processFile = async (fileToParse, flush) => {
        const fileData = await fspromises.readFile(fileToParse), base64FileData = fileData.toString("base64");
        const jsonReq = {filename: path.basename(fileToParse), data: base64FileData, id: userObj?.id || TEST_ID,
            org: userObj?.org || TEST_ORG, encoding: "base64", __forceDBFlush: flush, aiappid: userObj?.aiappid || TEST_APP };
        await indexFileAPIRequest(jsonReq)
    }
    for (const fileToParse of filesToTest.slice(0, -1)) indexingPromises.push(serialIngestion?await processFile(fileToParse, false):processFile(fileToParse, false));
    const lastFile = filesToTest[filesToTest.length-1]; indexingPromises.push(serialIngestion?await processFile(lastFile, true):processFile(lastFile, true)); // write out the DB to the disk

    if (!serialIngestion) await Promise.all(indexingPromises);    // wait for all files to finish if not using serial ingestion in the first place

    return finalResults === filesToTest.length;
}
