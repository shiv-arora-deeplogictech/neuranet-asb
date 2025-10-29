/**
 * Thai language segmenter. Needs NPM wordcut.
 * 
 * Use require("thsegmenter.js").getSegmenter() to get a new segmenter.
 * Use segmenter.segment("thai text") to segment. Returns word list.
 * (C) 2023 Tekmonks 
 */

const wordcut = require("wordcut");

exports.getSegmenter = _ => { return {
    segment: (text) => {
        wordcut.init();
        const segmented = wordcut.cut(text);
        return segmented.split("|");
    }
} }