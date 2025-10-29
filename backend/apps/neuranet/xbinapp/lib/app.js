/**
 * Initializes the application.
 * (C) TekMonks. All rights reserved.
 */

const fs = require("fs");
const mustache = require("mustache");
const XBIN_CONSTANTS = require(`${__dirname}/xbinconstants.js`);

exports.initSync = _appName => {
    const xbinson = mustache.render(fs.readFileSync(`${XBIN_CONSTANTS.CONF_DIR}/xbin.json`, "utf8"), 
        {...XBIN_CONSTANTS, hostname: CONSTANTS.HOSTNAME}).replace(/\\/g, "\\\\");   // escape windows paths
    XBIN_CONSTANTS.CONF = JSON.parse(xbinson);
    global.XBIN_CONSTANTS = XBIN_CONSTANTS; // setup constants
}