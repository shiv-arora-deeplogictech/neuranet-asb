/**
 * Tests overall AIAPP Operations like new, delete, publish and unpublish.
 * 
 * (C) 2023 Tekmonks. All rights reserved.
 */

const operateaiapp = require(`${NEURANET_CONSTANTS.APIDIR}/operateaiapp.js`);

const TEST_ID = "test@tekmonks.com", TEST_ORG = "Tekmonks";

exports.runTestsAsync = async function(argv) {
    if ((!argv[0]) || (argv[0].toLowerCase() != "aiapp")) {
        LOG.console(`Skipping AI Search test case, not called.\n`)
        return;
    }

    if (!argv[1]) { LOG.console("Missing AI Operation.\n"); return; } 
    if (!argv[2]) { LOG.console("Missing AIAPP_NAME to be operated.\n"); return; } 

    let userObj = argv.pop();
    if (typeof userObj === 'object') { const userConf = require(`${__dirname}/conf/testing.json`)[userObj.user];
        userObj = { ...userConf, aiappid: userObj["aiapp"] }; } else { argv.push(userObj); userObj = undefined; } 
        
    const op = argv[1].toLowerCase(), appname = argv[2], aiapplabel = argv[3];

    LOG.console(`Test case for AIAPP called to ${op} the appname ${appname}.\n`); 
    const jsonReq = { id: userObj?.id || TEST_ID, org: userObj?.org || TEST_ORG, aiappid: userObj?.aiappid || appname,
        op, aiapplabel };
    const operateResult = await operateaiapp.doService(jsonReq);

    setTimeout(_ => _, 2000);
    return operateResult.result;
}