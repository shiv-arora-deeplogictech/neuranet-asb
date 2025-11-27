/**
 * Shows how to init apps embedded into the login app.
 * (C) 2023 TekMonks. All rights reserved.
 */

const fs = require("fs");
const mustache = require("mustache");

exports.initSync = _approot => {
    _readConfSync();    // the files below need constants to be setup properly so require them after conf is setup

    const events = require(`${NEURANET_CONSTANTS.APIDIR}/events.js`);
    const aidbfs = require(`${NEURANET_CONSTANTS.LIBDIR}/aidbfs.js`);
    const dblayer = require(`${NEURANET_CONSTANTS.LIBDIR}/dblayer.js`);
    const fileindexer = require(`${NEURANET_CONSTANTS.LIBDIR}/fileindexer.js`);
    const loginhandler = require(`${NEURANET_CONSTANTS.LIBDIR}/loginhandler.js`);
    const brainhandler = require(`${NEURANET_CONSTANTS.LIBDIR}/brainhandler.js`);
    const textextractor = require(`${NEURANET_CONSTANTS.LIBDIR}/textextractor.js`);
    const neuranetAPIKeyChecker = require(`${NEURANET_CONSTANTS.LIBDIR}/neuranetAPIKeyChecker.js`);

    dblayer.initDBAsync(true); // yes this is async so there is a slim chance by the first call it is still loading
    loginhandler.initSync(); 
    fileindexer.initSync();
    events.initSync();
    brainhandler.initSync();
    aidbfs.initSync();
    neuranetAPIKeyChecker.initSync();
    textextractor.initAsync();  // yes this is async so there is a slim chance by the first call it is still loading

    const clusterSize = NEURANET_CONSTANTS.CONF.cluster_size ||     // if conf has cluster size use it, else try from distributed memory, else use local core count 
        (DISTRIBUTED_MEMORY.get(NEURANET_CONSTANTS.CLUSTERCOUNT_KEY) ?
            DISTRIBUTED_MEMORY.get(NEURANET_CONSTANTS.CLUSTERCOUNT_KEY) + 1 : undefined) || CLUSTER_MEMORY.configured_cluster_count;
    DISTRIBUTED_MEMORY.set(NEURANET_CONSTANTS.CLUSTERCOUNT_KEY, clusterSize);
}

function _readConfSync() {
    const hostname = fs.existsSync(`${NEURANET_CONSTANTS.HTTPDCONFDIR}/hostname.json`) ? 
        require(`${NEURANET_CONSTANTS.HTTPDCONFDIR}/hostname.json`) : CONSTANTS.HOSTNAME;

    const confjson = mustache.render(fs.readFileSync(`${NEURANET_CONSTANTS.CONFDIR}/neuranet.json`, "utf8"), 
        {...NEURANET_CONSTANTS, hostname, APPROOT: NEURANET_CONSTANTS.APPROOT}).replace(/\\/g, "\\\\");   // escape windows paths
    NEURANET_CONSTANTS.CONF = JSON.parse(confjson);
    global.NEURANET_CONSTANTS = NEURANET_CONSTANTS;
}