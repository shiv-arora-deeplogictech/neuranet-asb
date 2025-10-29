/**
 * Tests the Neuranet Lang detector.
 */

const fspromises = require("fs").promises;
const langdetector = require(`${NEURANET_CONSTANTS.THIRDPARTYDIR}/langdetector.js`);

exports.runTestsAsync = async function(argv) {
    if ((!argv[0]) || (argv[0].toLowerCase() != "langdetect")) {
        LOG.console(`Skipping Language detection test case, not called.\n`)
        return;
    }
    if (!argv[1]) {
        LOG.console("Missing test file/s path/s.\n");
        return;
    } 

    const fileContents = await fspromises.readFile(argv[1], "utf8");
    const lang = langdetector.getISOLang(fileContents);
    const successMsg = `The detected language for the document ${argv[1]} is ${lang}.\n`;
    LOG.info(successMsg); LOG.console(successMsg); 
    return true;
}