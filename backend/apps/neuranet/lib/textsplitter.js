/**
 * Splits the given document. 
 * 
 * (C) 2023 TekMonks. All rights reserved.
 * License: See the enclosed LICENSE file.
 */

exports.getSplits = function(document, chunk_size, split_separators, overlap=0) {
    let split_start = 0, split_end = (split_start+chunk_size) < document.length ? 
        _find_split_separator(document, split_start, split_start+chunk_size, split_separators) : document.length;

    const splitsToReturn = []; 
    while (split_end <= document.length && (split_start != split_end)) {
        const split = document.substring(split_start, split_end).trim(), skipSegement = (split.trim() == ""); 
        
        if (!skipSegement) splitsToReturn.push(split);
    
        const firstIndexOfSplitSeperatorInChunk = overlap ? 
            _firstIndexOfSplitSeperator(document.substring(split_end - overlap, split_end), split_separators) + 1 : 0;
        split_start = split_start && (split_end - overlap != split_start) && (split_end - overlap + firstIndexOfSplitSeperatorInChunk != split_start) ? 
            split_end - overlap + firstIndexOfSplitSeperatorInChunk : split_end; 
        split_end = (split_start+chunk_size) < document.length ? 
            _find_split_separator(document, split_start, split_start+chunk_size, split_separators) : document.length;
    }
    return splitsToReturn;
}

const _firstIndexOfSplitSeperator = (chunk, split_separators_raw) => {
    const split_separators = Array.isArray(split_separators_raw) ? split_separators_raw : [split_separators_raw];
    for (const split_separator of split_separators) if (chunk.indexOf(split_separator) != -1) return chunk.indexOf(split_separator);
    else return 0;
}

const _find_split_separator = (document, split_start, raw_split_point, split_separators_raw) => {
    const rawChunk = document.substring(split_start, raw_split_point), 
        split_separators = split_separators_raw ? 
            (Array.isArray(split_separators_raw) ? split_separators_raw : [split_separators_raw]) : [];

    let split_separator_to_use; for (const split_separator of split_separators) 
        if ((rawChunk.indexOf(split_separator) != -1) && (rawChunk.lastIndexOf(split_separator) != 0)) {
            split_separator_to_use = split_separator; break }
    if (split_separator_to_use == undefined) return raw_split_point;    // seperator not found -- so go with it all as is

    const split_point = split_start+rawChunk.lastIndexOf(split_separator_to_use);
    return split_point+1;
}

if (require.main === module) {
    const args = process.argv.slice(2);
    if (args.length == 0) {
        console.log("Usage: textsplitter <file> [split size, default: 1000] [seperators, comma seperated] [overlap, default: 0] ");
        process.exit(1);
    }
    const splitSize = parseInt(args[1])||1000, seperators = args[2]?args[2].split(","):[".","\n"," "], overlap = parseInt(args[2])||0;
    const splits = exports.getSplits(require("fs").readFileSync(args[0], "utf8"), splitSize, seperators, overlap);
    console.log(splits.join("\n\n\n\n**********************************************\n"));
}