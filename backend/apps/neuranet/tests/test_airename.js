/**
 * Tests the rename of files' API.
 * 
 * (C) 2023 Tekmonks. All rights reserved.
 */

const XBIN_CONSTANTS = NEURANET_CONSTANTS.XBIN_CONSTANTS;
const dblayer = require(`${NEURANET_CONSTANTS.LIBDIR}/dblayer.js`);
const renamefile = require(`${XBIN_CONSTANTS.API_DIR}/renamefile.js`);

const TEST_ID = "test@tekmonks.com", TEST_ORG = "Tekmonks";
const AI_UPLOAD_CMS_PATH = "uploads";

exports.runTestsAsync = async function(argv) {
    if ((!argv[0]) || (argv[0].toLowerCase() != "airename")) {
        LOG.console(`Skipping Rename File test case, not called.\n`)
        return;
    }
    if (!argv[1]||!argv[2]) {
        LOG.console("Missing test file/s path/s.\n");
        return;
    }
    let userObj = argv.pop();
    if (typeof userObj === 'object') { const userConf = require(`${__dirname}/conf/testing.json`)[userObj.user];
        userObj = { ...userConf, aiappid: userObj["aiapp"] }; } else { argv.push(userObj); userObj = undefined;}
    
    const jsonReq = {old: `/${AI_UPLOAD_CMS_PATH}/${argv[1]}`, new: `/${AI_UPLOAD_CMS_PATH}/${argv[2]}`,
        id: userObj?.id || TEST_ID, org: userObj?.org || TEST_ORG };
    LOG.console(`Test case for Rename File called to rename the file ${jsonReq.old} to ${jsonReq.new}.\n`);

    await dblayer.initDBAsync();    // we need DB before anything else happens
    let finalResult = true; const result = await renamefile.doService(jsonReq);
        if (result?.result) {
            const successMsg = `Test Renaming File of ${jsonReq.old} succeeded.\n`;
            LOG.info(successMsg); LOG.console(successMsg);
        } else {
            finalResult = false; const errorMsg = `Test Renamning File of ${jsonReq.old} failed.\n`;
            LOG.error(errorMsg); LOG.console(errorMsg);
    }

    setInterval(_=>{}, 1000);
    return finalResult;
}
