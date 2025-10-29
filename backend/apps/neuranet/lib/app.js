/**
 * Neuranet app init.
 * (C) 2023 TekMonks. All rights reserved.
 */

exports.initSync = function(_app, approot) {
    global.LOGINAPP_CONSTANTS = {ENV: {}}; // legacy
    require(`${approot}/xbinapp/lib/init.js`).initSync();    // because we rely on XBin's constants in Neuranet

    const NEURANET_APP_LIBDIR = `${approot}/lib`;
    global.NEURANET_CONSTANTS = require(`${NEURANET_APP_LIBDIR}/neuranetconstants.js`);
    global.NEURANET_CONSTANTS.XBIN_CONSTANTS = global.XBIN_CONSTANTS;

    require(`${NEURANET_CONSTANTS.LIBDIR}/init.js`).initSync(approot);
}