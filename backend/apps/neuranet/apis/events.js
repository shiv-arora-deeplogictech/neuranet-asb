/**
 * Processes and informs about Neuranet events.
 * 
 * (C) 2023 Tekmonks Corp. All rights reserved.
 * License: See the enclosed LICENSE file.
 */

const blackboard = require(`${CONSTANTS.LIBDIR}/blackboard.js`);

const EVENTS_KEY = "__org_monkshu_neuranet_events_key", MEM_TO_USE = CLUSTER_MEMORY;

exports.initSync = _ => blackboard.subscribe(NEURANET_CONSTANTS.NEURANETEVENT, message => {
    if ((message.type != NEURANET_CONSTANTS.EVENTS.AIDB_FILE_PROCESSING && 
        message.type != NEURANET_CONSTANTS.EVENTS.AIDB_FILE_PROCESSED && 
        message.type != NEURANET_CONSTANTS.EVENTS.AIDB_FILE_PROGRESS) || (!message.path)) return;  // we only care about these 

    const usermemory = _getUserMemory(message.id, message.org);
    const percentComplete = _calculateAndUpdatePercentage(message);
    const thisFilePreviouslyDone = usermemory[message.cmspath]?.done;    
    usermemory[message.cmspath] = {...message, path: message.cmspath,   // overwrite full path as we don't want to send this out
        done: thisFilePreviouslyDone || (message.type == NEURANET_CONSTANTS.EVENTS.AIDB_FILE_PROCESSED),    // if done previously a delayed processing message delivery may override it, so prevent that here
        result: message.result, percentage: percentComplete};
    _setUserMemory(message.id, message.org, usermemory);
    LOG.info(`File progress update for ${message.path}, percent: ${percentComplete}%, id ${message.id} and org ${message.org}, done status is ${usermemory[message.cmspath].done}.`);
});

exports.doService = async jsonReq => {
    if (!validateRequest(jsonReq)) {LOG.error("Validation failure."); return CONSTANTS.FALSE_RESULT;}

    const usermemory = _getUserMemory(jsonReq.id, jsonReq.org);
    return {events: (usermemory||{}), ...CONSTANTS.TRUE_RESULT};
}

/**
 * This function will calculate the percentage 
 * @param {Object} message The message broadcasted by the publised event
 * @returns The message percentage completion
 */
const _calculateAndUpdatePercentage = message => {
    let percentage = 0;
    if(message.type == NEURANET_CONSTANTS.EVENTS.AIDB_FILE_PROCESSED) percentage = 100; // done processing, emitted by fileindexer
    else if (message.type == NEURANET_CONSTANTS.EVENTS.AIDB_FILE_PROCESSING) percentage = 0;    // just started, emitted by fileindexer
    else if (message.type == NEURANET_CONSTANTS.EVENTS.AIDB_FILE_PROGRESS)
        percentage = Math.round((message.stepNum/message.totalSteps)*100);  // this message is for mid-way processing - emitted by ingestion plugins 
    return percentage;
}

const _setUserMemory = (id, org, usermemory) => { const memory = MEM_TO_USE.get(EVENTS_KEY, {}); 
    memory[_getmemkey(id, org)] = usermemory; MEM_TO_USE.set(EVENTS_KEY, memory); }
const _getUserMemory = (id, org) => { const memory = MEM_TO_USE.get(EVENTS_KEY, {});
    if (!memory[_getmemkey(id, org)])  memory[_getmemkey(id, org)] = {}; return memory[_getmemkey(id, org)]; }
const _getmemkey = (id, org) => `${id}_${org}`;

const validateRequest = jsonReq => (jsonReq && jsonReq.id && jsonReq.org);