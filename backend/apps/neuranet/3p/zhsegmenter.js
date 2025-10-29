/**
 * Chinese language segmenter. Needs NPM novel-segment.
 * 
 * Use require("zhsegmenter.js").getSegmenter() to get a new segmenter.
 * Use segmenter.segment("chinese text") to segment. Returns word list.
 * (C) 2023 Tekmonks 
 */

const NovelSegment = require("novel-segment");
const zhsegmenter = new NovelSegment(); zhsegmenter.useDefault();

exports.getSegmenter = _ => { return {
    segment: (text, doStem=true) => {
        const wordObjects = zhsegmenter.doSegment(text, {stripPunctuation: true, convertSynonym: doStem});
        const wordList = []; for (const wordObject of wordObjects) if (wordObject.w) wordList.push(wordObject.w);
        return wordList;
    }
} }