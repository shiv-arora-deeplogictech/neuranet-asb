/**
 * Tests the Apache Tika based text extractor.
 * 
 * (C) 2023 Tekmonks. All rights reserved.
 */
const tika = require(`${NEURANET_CONSTANTS.PLUGINSDIR}/tika/tika.js`);

exports.runTestsAsync = async function(argv) {
    if ((!argv[0]) || (argv[0].toLowerCase() != "extracttext")) {
        LOG.console(`Skipping extract text test case, not called.\n`)
        return;
    }
    if (!argv[1]) {LOG.console("Missing extraction file's path.\n"); return;} 
    const filesToTest = argv.slice(1).map(path => `${__dirname}/assets/${path}`);

    const forceTika = (argv[2]?.toLowerCase() == true);

    try { await tika.initAsync(); } catch (err) { 
        const error = `Can't initialize Tika. Error is ${err}.`; LOG.error(error); LOG.console(error); return false; }
        const outputPromises = []; for (const pathToFile of filesToTest) {
        const extractorFunction = async _ => {
            const result = await tika.getContent(pathToFile, forceTika);  // test text extraction using the Tika plugin
            if (!result) return false;
            const outputText = result.toString("utf8");
            const outputMsg = `Extracted text for file ${pathToFile} follows\n\n\n--------\n${outputText}\n--------\n\n\n`; 
            LOG.info(outputMsg); LOG.console(outputMsg);
        }
        outputPromises.push(extractorFunction());
    }
    await Promise.all(outputPromises);
    return true;
}