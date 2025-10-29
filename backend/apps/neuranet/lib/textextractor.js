/**
 * Used to extract UTF-8 text from any file. Uses text extraction plugins.
 * 
 * (C) 2023 TekMonks. All rights reserved.
 * License: See the enclosed LICENSE file.
 */

const conf = require(`${NEURANET_CONSTANTS.CONFDIR}/textextractor.json`); 

exports.initAsync = async _ => {
    for (const textExtractor of conf.text_extraction_plugins) 
        if (textExtractor.initAsync) await textExtractor.initAsync();
}

exports.extractTextAsStreams = function(inputstream, filepath) {
    return new Promise(async (resolve, reject) => { // stream processing can throw errors midway, so promise is used
        inputstream.on("error", error => 
            reject(new Error(`Unable to process the given file to extract the text due to error ${error}`)));
    
        for (const textExtractor of conf.text_extraction_plugins) {
            const pluginThis = NEURANET_CONSTANTS.getPlugin(textExtractor); 
            try {
                const extractedTextStream = await pluginThis.getContentStream(inputstream, filepath);
                if (extractedTextStream) resolve(extractedTextStream);
            } catch (err) {LOG.warn(`Error thrown by text extractin plugin ${textExtractor} for file ${filepath}, ignoring.`);}
        } 
    
        reject(new Error(`Unable to process the given file to extract the text.`));
    }); 
}

exports.extractTextAsBuffer = function(filepath, forceExtract=false) {
    return new Promise(async (resolve, reject) => { // stream processing can throw errors midway, so promise is used
    
        for (const textExtractor of conf.text_extraction_plugins) {
            const pluginThis = NEURANET_CONSTANTS.getPlugin(textExtractor); 
            try {
                const extractedText = await pluginThis.getContent(filepath, forceExtract);
                if (extractedText) resolve(extractedText);
            } catch (err) {LOG.warn(`Error thrown by text extractin plugin ${textExtractor} for file ${filepath}, ignoring.`);}
        } 
    
        reject(new Error(`Unable to process the given file to extract the text.`));
    }); 
}