/**
 * Handles all Neuranet plugins. This is a blocking function potentially,
 * the first time per process as require is blocking.
 * 
 * (C) 2023 Tekmonks Corp. All rights reserved.
 * License: See the enclosed LICENSE file.
 */

const serverutils = require(`${CONSTANTS.LIBDIR}/utils.js`);

const PLUGINS_CACHE = {};

exports.getPlugin = function(name) {
    const debug = NEURANET_CONSTANTS.CONF.debug_mode;
    if (debug) return serverutils.requireWithDebug(`${NEURANET_CONSTANTS.APPROOT}/plugins/${name}/${name}.js`, debug);
    
    if (PLUGINS_CACHE[name]) return PLUGINS_CACHE[name];
    
    PLUGINS_CACHE[name] = serverutils.requireWithDebug(`${NEURANET_CONSTANTS.APPROOT}/plugins/${name}/${name}.js`, debug);
    return PLUGINS_CACHE[name];
}