/**
 * Creates and returns a random embedding vector. Useful only for
 * testing (eg performance testing).
 * (C) 2022 TekMonks. All rights reserved.
 */

const fspromises = require("fs").promises;
const utils = require(`${CONSTANTS.LIBDIR}/utils.js`);

exports.getSampleResponse = async function(sampleTemplatePath, length, pathToEmbedTo) {
    const sampleTemplate = JSON.parse(await fspromises.readFile(
        `${NEURANET_CONSTANTS.RESPONSESDIR}/${sampleTemplatePath}`, "utf8"));
    utils.setObjProperty(sampleTemplate, pathToEmbedTo, _genVector(length));
    return sampleTemplate;
}

const _genVector = length => {
    const vector = []; for (let i = 0; i < length; i++) vector.push(Math.random()*(Math.random() > 0.5 ? 1:-1));
    return vector;
}