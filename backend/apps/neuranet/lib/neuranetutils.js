/**
 * Utils for Neuranet
 * 
 * (C) 2023 TekMonks. All rights reserved.
 * License: See the enclosed LICENSE file.
 */

/**
 * Reads the full file contents of the given stream.
 * @param {stream.Readable} stream The stream to read.
 * @param {string} encoding The return encoding, can be null, then a
 *                          buffer is returned.
 * @returns The full contents in the given encoding or 
 *          a Buffer with all the contents if no encoding is provided.
 */

const DEFAULT_MAX_PATH_LENGTH = 50;

exports.readFullFile = function(stream, encoding) {
    return new Promise((resolve, reject) => {
        const contents = [];
        stream.on("data", chunk => contents.push(chunk));
        stream.on("close", _ => resolve(encoding?Buffer.concat(contents).toString(encoding):Buffer.concat(contents)));
        stream.on("error", err => reject(err));
    });
}

/**
 * Converts an arbitrary string into a filesystem- and URL-safe path fragment.
 * 
 * The function:
 * - Uses encodeURIComponent to escape unsafe characters (e.g., spaces, symbols).
 * - Prevents trailing dots, which can cause filesystem issues on some platforms.
 * - Enforces a maximum path length to avoid OS and filesystem limits.
 * - Appends a timestamp when truncation is required to reduce collision risk.
 *
 * @param {string} s The input string to normalize (e.g., org name, app id).
 * @param {number} maxPathLength Maximum allowed length of the generated path.
 * @returns {string} A normalized, URL-safe, and filesystem-safe path fragment.
 */

exports._convertToPathFriendlyString = function(s, maxPathLength=DEFAULT_MAX_PATH_LENGTH) {
    let tentativeFilepath = encodeURIComponent(s);
    if (tentativeFilepath.endsWith(".")) tentativeFilepath = tentativeFilepath.substring(0,tentativeFilepath.length-1)+"%2E";
        
    if (tentativeFilepath.length > maxPathLength) {
        tentativeFilepath = tentativeFilepath + "." + Date.now();
        tentativeFilepath = tentativeFilepath.substring(tentativeFilepath.length-maxPathLength);
    }
    
    return tentativeFilepath;
}
