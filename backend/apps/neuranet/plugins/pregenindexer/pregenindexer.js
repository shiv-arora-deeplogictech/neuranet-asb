/**
 * Indexes the given document as a pre-gen flow (GARAGe) 
 * approach.
 * 
 * All pregen plugins must contain this function
 * async function generate(fileindexer, generatorDefinition)
 * 
 * (C) 2023 TekMonks. All rights reserved.
 * License: See the enclosed LICENSE file.
 */

const path = require("path");
const conf = require(`${__dirname}/pregenindexer.json`);
const serverutils = require(`${CONSTANTS.LIBDIR}/utils.js`);
const aiapp = require(`${NEURANET_CONSTANTS.LIBDIR}/aiapp.js`);
const blackboard = require(`${CONSTANTS.LIBDIR}/blackboard.js`);

/** @return true if we can handle else false */
exports.canHandle = async fileindexer => {
    if (conf.skip_extensions.includes(path.extname(fileindexer.filepath).toLowerCase())) return false; 
    return true;    // if enabled to pregen, then we can handle all files
}

/**
 * Will ingest the given file and generate the corresponding pregen files for it.
 * @param {object} fileindexer The file indexer object
 * @returns true on success or false on failure
 */
exports.ingest = async function(fileindexer) {
    const pregenSteps = await _getPregenStepsAIApp(fileindexer), 
        totalPregentSteps = (pregenSteps.length*3)+1;  // 3 substeps (gen, add to CMS, add to AI) + 1 for add to AI for original doc
    const _informProgress = stepNum => _publishProgressEvent(fileindexer, stepNum, totalPregentSteps);

    await fileindexer.start(); 
    let currentStep = 0; for (const pregenStep of pregenSteps) {
        if (!await _condition_to_run_met(pregenStep, fileindexer)) continue;    // run only if condition is satisfied
        
        const fileAlreadyGenerated = await serverutils.exists(pregenStep.cmspath);   // other cluster members may have already generated the file
        const pregenResult = fileAlreadyGenerated ? {result: true} :   
            await pregenStep.generate(fileindexer); _informProgress(++currentStep);

        if (pregenResult.result) {
            const addGeneratedFileToCMSResult = fileAlreadyGenerated ? true : await fileindexer.addFileToCMSRepository(
                pregenResult.contentBufferOrReadStream(), pregenStep.cmspath, pregenStep.comment, true);    // no AI event needed as we add to AI ourselves below
            _informProgress(++currentStep);

            const indexResult = addGeneratedFileToCMSResult ? 
                await fileindexer.addFileToAI(pregenStep.cmspath, pregenResult.lang) : {result: false}; 
            _informProgress(++currentStep);

            if (!indexResult) LOG.error(`Pregen failed at step ${pregenStep.label} in adding generated file ${pregenStep.cmspath}.`);
            else LOG.info(`Pregen succeeded at step ${pregenStep.label} in adding generated file ${pregenStep.cmspath}.`);
        } else {
            _informProgress(currentStep+=2);    // generation and add file to AI didn't run, so update counts
            LOG.error(`Pregen failed at step ${pregenStep.label} in generate for file ${pregenStep.cmspath}.`);
        }
    }

    const aiappObject = await aiapp.getAIApp(fileindexer.id, fileindexer.org, fileindexer.aiappid), 
        genfilesDir = aiappObject.generated_files_path;
    const cmsGenTextFilePath = `${path.dirname(fileindexer.cmspath)}/${genfilesDir}/${path.basename(fileindexer.cmspath)}.txt`;
    const rootComment = `Text for: ${path.basename(fileindexer.cmspath)}`;
    // save the extracted text as well to the CMS but no AI event as we already add original text to AI below
    const rootIndexerResultCMS = await fileindexer.addFileToCMSRepository(await fileindexer.getReadstream(), cmsGenTextFilePath, rootComment, true);  
    const rootIndexerResultAI = await fileindexer.addFileToAI();    // add the original file to AI
    await fileindexer.end(); _informProgress(totalPregentSteps);

    if (!rootIndexerResultCMS) LOG.error(`Pregen failed at adding original file for file ${fileindexer.cmspath}'s extracted text.`);
    if (!rootIndexerResultAI) LOG.error(`Pregen failed at adding original file to AI ${fileindexer.cmspath}.`);
    else LOG.info(`Pregen succeeded at adding original file for file ${fileindexer.cmspath}.`);
    return rootIndexerResultAI;  // adding original file to AI is the the only important thing
}

/**
 * Will uningest the given file and uningest the corresponding pregen (GARAGe) files for it.
 * @param {object} fileindexer The file indexer object
 * @returns true on success or false on failure
 */
exports.uningest = async function(fileindexer) {
    await fileindexer.start();
    const pregenSteps = await _getPregenStepsAIApp(fileindexer); 
    for (const pregenStep of pregenSteps) {
        if (!await _condition_to_run_met(pregenStep, fileindexer)) continue;    // run only if condition is satisfied
        const delGeneratedFileFromCMSResult = await fileindexer.deleteFileFromCMSRepository(pregenStep.cmspath, true);
        const stepIndexerResult = delGeneratedFileFromCMSResult ? await fileindexer.removeFileFromAI(pregenStep.cmspath) : {result: false};
        if (!stepIndexerResult.result) LOG.error(`Pregen removal failed at step ${pregenStep.label} in removing generated file ${pregenStep.cmspath}.`); 
        else LOG.info(`Pregen removal succeeded at step ${pregenStep.label} in removing generated file ${pregenStep.cmspath}.`); 
    }
    
    const aiappObject = await aiapp.getAIApp(fileindexer.id, fileindexer.org, fileindexer.aiappid), genfilesDir = aiappObject.generated_files_path;    
    const cmsGenTextFilePath = `${path.dirname(fileindexer.cmspath)}/${genfilesDir}/${path.basename(fileindexer.cmspath)}.txt`;
    const rootIndexerResultCMS = await fileindexer.deleteFileFromCMSRepository(cmsGenTextFilePath, true);  // remove the extracted text as well
    const rootIndexerResultAI = await fileindexer.removeFileFromAI(); await fileindexer.end();
    if (!rootIndexerResultCMS) LOG.error(`Pregen failed at removing original file ${fileindexer.cmspath}'s extracted text.`);
    if (!rootIndexerResultAI.result) LOG.error(`Pregen failed at removing original file (AI DB uningestion failure) ${fileindexer.cmspath}.`);
    else LOG.info(`Pregen succeeded at removing original file ${fileindexer.cmspath}.`);
    return rootIndexerResultAI.result;  // removing original file from AI is the the only important thing
}

/**
 * Will rename the given file and rename the corresponding pregen (GARAGe) files for it.
 * @param {bject} fileindexer The file indexer object
 * @returns true on success or false on failure
 */
exports.rename = async function(fileindexer) {
    await fileindexer.start();
    const pregenSteps = await _getPregenStepsAIApp(fileindexer); 
    for (const pregenStep of pregenSteps) {
        if (!await _condition_to_run_met(pregenStep, fileindexer)) continue;    // run only if condition is satisfied
        const renameGeneratedFileToCMSResult = await fileindexer.renameFileFromCMSRepository(pregenStep.cmspath,
            pregenStep.cmspathTo, true);
        const stepIndexerResult = renameGeneratedFileToCMSResult ? 
            await fileindexer.renameFileToAI(pregenStep.cmspath, pregenStep.cmspathTo) : false;
        if (!stepIndexerResult.result) LOG.error(`Pregen rename failed at step ${pregenStep.label} in rename generated file.`);
    }

    const aiappObject = await aiapp.getAIApp(fileindexer.id, fileindexer.org, fileindexer.aiappid), 
        genfilesDir = aiappObject.generated_files_path;    const cmsGenTextFilePath = `${path.dirname(fileindexer.cmspath)}/${genfilesDir}/${path.basename(fileindexer.cmspath)}.txt`;
    const cmsGenTextFilePathTo = `${path.dirname(fileindexer.cmspathTo)}/${genfilesDir}/${path.basename(fileindexer.cmspathTo)}.txt`;
    const rootIndexerResultCMS = await fileindexer.renameFileFromCMSRepository(cmsGenTextFilePath, cmsGenTextFilePathTo, true);  // rename the extracted text as well
    if (!rootIndexerResultCMS) LOG.error(`Pregen failed at renaming original file ${fileindexer.cmspath}'s extracted text.`);
    const rootIndexerResultAI = await fileindexer.renameFileToAI();
    await fileindexer.end(); if (!rootIndexerResultAI.result) LOG.error(`Pregen failed at renaming original file (AI DB rename failure).`);
    return rootIndexerResultAI.result;  // renaming original file to AI is the the only important thing
}

async function _getPregenStepsAIApp(fileindexer) {
    const pregenStepObjects = await aiapp.getPregenObject(fileindexer.id, fileindexer.org, fileindexer.aiappid);
    const pregenFunctions = []; for (const pregenStepObject of pregenStepObjects) {
        const genfilesDir = pregenStepObject.in.pregenfile_dir, genfilesExt = pregenStepObject.in.pregenfile_ext, genfilesPrefix = pregenStepObject.in.pregenfile_prefix;
            cmspath = `${path.dirname(fileindexer.cmspath)}/${genfilesDir}/${genfilesPrefix}_${path.basename(fileindexer.cmspath)}.${genfilesExt}`,
            cmspathTo = fileindexer.cmspathTo ? `${path.dirname(fileindexer.cmspathTo)}/${genfilesDir}/${genfilesPrefix}_${path.basename(fileindexer.cmspathTo)}.${genfilesExt}` : undefined,
            comment = `${pregenStepObject.in.label}: ${path.basename(fileindexer.cmspath)}`,
            commentTo = fileindexer.cmspathTo ? `${pregenStepObject.in.label}: ${path.basename(fileindexer.cmspathTo)}` : undefined;
        const [command, command_function] = pregenStepObject.command.split(".");
        if (path.dirname(fileindexer.cmspath).trim().endsWith(genfilesDir)) {
            LOG.info(`Skipping pregen for file ${fileindexer.cmspath} for org ${fileindexer.org} and ID ${fileindexer.id} as it is already an automatically pregenerated file.`);
            continue;   // do not recursively generate based on an already pregen file
        }
        pregenFunctions.push({
            generate: async fileindexer => (await aiapp.getCommandModule(fileindexer.id, fileindexer.org, 
                fileindexer.aiappid, command))[command_function||aiapp.DEFAULT_ENTRY_FUNCTIONS.pregen_flow](fileindexer, pregenStepObject.in),
            label: pregenStepObject.in.label,
            condition_js: pregenStepObject["condition_js"],
            cmspath, comment, cmspathTo, commentTo
        });
    }
        
    return pregenFunctions;
}

async function _condition_to_run_met(pregenStep, fileindexer) {
    const condition_code = pregenStep["condition_js"];
    if (condition_code) return await _runJSCode(condition_code, {NEURANET_CONSTANTS, 
        require: function() {const module = require(...arguments); return module}, fileindexer }); 
    else return true;   // no condition specified
}

async function _runJSCode(code, context) {
    try {return await (serverutils.createAsyncFunction(code)(context))} catch (err) {
        LOG.error(`Error running custom JS code error is: ${err}`); return false;
    }
}

const _publishProgressEvent = (fileindexer, stepNum, totalSteps) => blackboard.publish(
    NEURANET_CONSTANTS.NEURANETEVENT, {type: NEURANET_CONSTANTS.EVENTS.AIDB_FILE_PROGRESS, result:true, 
        id: fileindexer.id, org: fileindexer.org, path: fileindexer.filepath, cmspath: fileindexer.cmspath, 
        extraInfo: fileindexer.extraInfo, stepNum, totalSteps});
