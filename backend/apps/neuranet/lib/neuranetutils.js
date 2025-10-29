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
exports.readFullFile = function(stream, encoding) {
    return new Promise((resolve, reject) => {
        const contents = [];
        stream.on("data", chunk => contents.push(chunk));
        stream.on("close", _ => resolve(encoding?Buffer.concat(contents).toString(encoding):Buffer.concat(contents)));
        stream.on("error", err => reject(err));
    });
}