/**
 * Tests the create and operate's write algorithms.
 * 
 * (C) 2023 Tekmonks. All rights reserved.
 */
const blackboard = require(`${CONSTANTS.LIBDIR}/blackboard.js`);
const XBIN_CONSTANTS = NEURANET_CONSTANTS.XBIN_CONSTANTS;
const createfile = require(`${XBIN_CONSTANTS.API_DIR}/createfile.js`);
const operatefile = require(`${XBIN_CONSTANTS.API_DIR}/operatefile.js`);

const TEST_ID = "test@tekmonks.com", TEST_ORG = "Tekmonks";
const AI_UPLOAD_CMS_PATH = "uploads";

exports.runTestsAsync = async function(argv) {
    if ((!argv[0]) || (argv[0].toLowerCase() != "aicreate")) {
        LOG.console(`Skipping Create File test case, not called.\n`)
        return;
    }
    if (!argv[1]) { LOG.console("Missing test file Name.\n"); return; }
    const fileName = argv[1], isDirectory = !fileName.includes(".");
    
    if(!argv[2]) { LOG.console("Missing test file Data.\n"); return; }
    const data = argv[2], cmsRelativePath = `${AI_UPLOAD_CMS_PATH}/${fileName}`;
    
    LOG.console(`Test case for Create File called to create the file ${fileName}.\n`);

    let userObj = argv.pop();
    if (typeof userObj === 'object') { const userConf = require(`${__dirname}/conf/testing.json`)[userObj.user];
        userObj = { ...userConf, aiappid: userObj["aiapp"] };} else { argv.push(userObj); userObj = undefined; }
    
    const headers = { xbin_id: userObj?.id || TEST_ID, xbin_org: userObj?.org || TEST_ORG};

    let result = await createfile.doService({path: cmsRelativePath, isDirectory}, "", headers);
    if(!result) { LOG.console("file creation failed\n"); return false; }
    else LOG.console(`file:'${fileName}' created\n`); LOG.info(`file:'${fileName}' created`);

    const jsonReq = { op: "write", path: cmsRelativePath, data: data};
    result = await operatefile.doService(jsonReq, "", headers);

    const aidbFileProcessedPromise = new Promise(resolve => blackboard.subscribe(
        NEURANET_CONSTANTS.NEURANETEVENT, function(message) { 
            if (message.type == NEURANET_CONSTANTS.EVENTS.AIDB_FILE_PROCESSED && 
                (message.cmspath === cmsRelativePath)) {
            blackboard.unsubscribe(NEURANET_CONSTANTS.NEURANETEVENT, this); resolve(message); }
        }
    ));
    await aidbFileProcessedPromise;
    
    if (result?.result) {
        const successMsg = `file:'${fileName}' ingested.\n`;
        LOG.info(successMsg); LOG.console(successMsg); return true;
    } else {
        const errorMsg = `file ${fileName} ingestion failed & content not saved.\n`;
        LOG.error(errorMsg); LOG.console(errorMsg); return false;
    }
}
