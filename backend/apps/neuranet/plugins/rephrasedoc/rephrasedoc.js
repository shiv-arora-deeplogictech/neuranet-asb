/**
 * Rephrases the document and returns the new document.
 * 
 * (C) 2023 TekMonks. All rights reserved.
 * License: See the enclosed LICENSE file.
 */

const aiapp = require(`${NEURANET_CONSTANTS.LIBDIR}/aiapp.js`);
const simplellm = require(`${NEURANET_CONSTANTS.LIBDIR}/simplellm.js`);
const textsplitter = require(`${NEURANET_CONSTANTS.LIBDIR}/textsplitter.js`);
const langdetector = require(`${NEURANET_CONSTANTS.THIRDPARTYDIR}/langdetector.js`);

const PROMPT_PARAM = "_promptparam", CHAT_MODEL = "chat", EMBEDDINGS_MODEL = "embeddings", 
    CHAT_MODEL_DEFAULT = "simplellm-openai", EMBEDDINGS_MODEL_DEFAULT = "embedding-openai";

async function generate(fileindexer, generatorDefinition) {
    let chatModelDefinition, embeddingsModelDefinition; for (const model of (generatorDefinition.models||[])) {
        if (model.type == CHAT_MODEL) chatModelDefinition = model;
        if (model.type == EMBEDDINGS_MODEL) embeddingsModelDefinition = model;
    }; 
    chatModelDefinition = chatModelDefinition || {name: CHAT_MODEL_DEFAULT, model_overrides: {}};
    embeddingsModelDefinition = embeddingsModelDefinition || {name: EMBEDDINGS_MODEL_DEFAULT, model_overrides: {}};

    let document; try {document = await fileindexer.getTextContents(generatorDefinition.encoding||"utf8")} catch (err) {LOG.error(`Error in extracting text from document due to ${err}`);}
    if (!document) {LOG.error(`File content extraction failed for ${fileindexer.filepath}.`); return {result: false};}
    document = document.replace(/\s*\n\s*/g, "\n").replace(/[ \t]+/g, " ");

    const modelObject = await aiapp.getAIModel(chatModelDefinition.name, chatModelDefinition.model_overrides, fileindexer.id, fileindexer.org, fileindexer.aiappid),
        embeddingsModel = await aiapp.getAIModel(embeddingsModelDefinition.name, embeddingsModelDefinition.model_overrides, fileindexer.id, fileindexer.org, fileindexer.aiappid);

    const langDetected = langdetector.getISOLang(document),
        split_separators = embeddingsModel.split_separators[langDetected] || embeddingsModel.split_separators["*"],
        split_joiners = embeddingsModel.split_joiners[langDetected] || embeddingsModel.split_joiners["*"],
        split_size = embeddingsModel.request_chunk_size[langDetected] || embeddingsModel.request_chunk_size["*"],
        splits = textsplitter.getSplits(document, split_size, split_separators, 0);

    const promptData = {lang: langDetected}; for (const [key,value] of Object.entries(generatorDefinition)) {
        const keyNormalized = key.toLowerCase().trim();
        if (keyNormalized.endsWith(PROMPT_PARAM)) promptData[keyNormalized.substring(0, keyNormalized.lastIndexOf("_"))] = value;
    }

    const queueAnswer = async (promptToUse, promptData, sequence) => {
        const rephrasedSplit = await simplellm.prompt_answer(promptToUse, fileindexer.id, fileindexer.org, 
            fileindexer.aiappid, promptData, modelObject);
        if (!rephrasedSplit) throw `SimpleLLM error in rephrasing ${promptToUse}`;
        rephrasedSplits.push({content: rephrasedSplit||"", sequence}) ;
    }
    let rephrasedSplits = [], promisesToWaitFor = []; for (const [index, split] of splits.entries()) {
        const lang_fragment = langdetector.getISOLang(split);
        const promptDataClone = { ...promptData, fragment: split, lang_fragment }; // shallow copy per iteration
        const promptToUse = generatorDefinition[`prompt_fragment_${lang_fragment}`] || generatorDefinition[`prompt_${langDetected}`] || generatorDefinition.prompt;
        promisesToWaitFor.push(queueAnswer(promptToUse, promptDataClone, index));
    }
    try {await Promise.all(promisesToWaitFor)} catch (err) {
        LOG.error(`Unable to generate rephrased document due to error ${err}`);
        return {result: false};
    }
    rephrasedSplits.sort((v1, v2) => v1.sequence < v2.sequence ? -1 : v1.sequence > v2.sequence ? 1 : 0);
    let joinedConent=""; for (const rephrasedSplit of rephrasedSplits) joinedConent += rephrasedSplit.content+split_joiners[0];

    return {result: true, contentBufferOrReadStream: _ => Buffer.from(joinedConent, generatorDefinition.encoding||"utf8"), lang: langDetected};
}

module.exports = {generate}