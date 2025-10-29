/**
 * Language detector. Uses trigram algorithms to detect language in the
 * text.
 * 
 * (C) 2023 Tekmonks. All rights reserved.
 */

const {detect} = require("tinyld/heavy");
const conf = require(`${NEURANET_CONSTANTS.CONFDIR}/lang.json`);
const textsplitter = require(`${NEURANET_CONSTANTS.LIBDIR}/textsplitter.js`);

/**
 * Returns the dominant language inside the provided text as the language for it.
 * @param {string} text The text which should be detected.
 * @returns The dominant language inside the provided text as the language for it.
 */
exports.getISOLang = function(text) {
    if(!text) return "en";  // if no text then return english as default
    const langs_detected = {}, splits = textsplitter.getSplits(text, conf.langdetector_chunk_size);
    for (const split of splits) {
        const langThisSplit = detect(split.trim());
        if (langThisSplit) langs_detected[langThisSplit] = (langs_detected[langThisSplit] || 0)+1;
    }
    if (!(Object.keys(langs_detected).length)) return "en";  // default to English
    
    let langToReturn, max_count=0; for (const [lang, count] of Object.entries(langs_detected)) if (count > max_count) {
        max_count = count; langToReturn = lang;
    }
    return langToReturn;
}
