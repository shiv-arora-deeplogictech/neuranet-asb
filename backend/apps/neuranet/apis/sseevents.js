/**
 * Processes and informs about Neuranet events.
 * 
 * (C) 2023 Tekmonks Corp. All rights reserved.
 * License: See the enclosed LICENSE file.
 */

const blackboard = require(`${CONSTANTS.LIBDIR}/blackboard.js`);

const EVENTS_KEY = "__org_monkshu_neuranet_events_key", MEM_TO_USE = CLUSTER_MEMORY,
    NN_FILEUPDATE_EVENT_NAME = "nnfileupdate", NN_THOUGHTS_EVENT_NAME = "thoughts",
    NN_LLM_RESULT_EVENT_NAME = "_org_monkshu_api_sse_event_";  // must match SERVER_SSE_EVENTS_NAME in apimanager.mjs

exports.initSync = _ => blackboard.subscribe(NEURANET_CONSTANTS.NEURANETEVENT, message => {
    if ((message.type != NEURANET_CONSTANTS.EVENTS.AIDB_FILE_PROCESSING && 
        message.type != NEURANET_CONSTANTS.EVENTS.AIDB_FILE_PROCESSED && 
        message.type != NEURANET_CONSTANTS.EVENTS.AIDB_FILE_PROGRESS) || (!message.path)) return;  // we only care about these 

    const usermemory = _getUserMemory(message.id, message.org);
    const percentComplete = _calculateAndUpdatePercentage(message);
    const thisFilePreviouslyDone = usermemory[message.cmspath]?.done;   
    if (!usermemory.fileevents) usermemory.fileevents = {}; 
    usermemory.fileevents[message.cmspath] = {...message, path: message.cmspath,   // overwrite full path as we don't want to send this out
        done: thisFilePreviouslyDone || (message.type == NEURANET_CONSTANTS.EVENTS.AIDB_FILE_PROCESSED),    // if done previously a delayed processing message delivery may override it, so prevent that here
        result: message.result, percentage: percentComplete};
    _setUserMemory(message.id, message.org, usermemory);
    LOG.info(`File progress update for ${message.path}, percent: ${percentComplete}%, id ${message.id} and org ${message.org}, done status is ${usermemory[message.cmspath].done}.`);
});

exports.doSSE = async (jsonReq, sseEventSender) => {
    const usermemory = _getUserMemory(jsonReq.id, jsonReq.org);
    if (usermemory) {
        sseEventSender({event: NN_FILEUPDATE_EVENT_NAME, id: Date.now(), data:{events: (usermemory.fileevents||{})}});
        sseEventSender({event: NN_THOUGHTS_EVENT_NAME, id: Date.now(), data:{events: (usermemory.thoughts||{})}});
        if (usermemory.llmresults && Object.keys(usermemory.llmresults).length) {
            for (const [requestid, response] of Object.entries(usermemory.llmresults))
                sseEventSender({event: NN_LLM_RESULT_EVENT_NAME, id: Date.now(), data:{requestid, response}});
            usermemory.llmresults = {};   // one-shot: clear after delivery
            _setUserMemory(jsonReq.id, jsonReq.org, usermemory);
        }
    }
}

exports.emitLLMResult = (id, org, messageID, result) => {
    const usermemory = _getUserMemory(id, org);
    if (!usermemory.llmresults) usermemory.llmresults = {};
    usermemory.llmresults[messageID] = result;  // stored as {requestid: messageID, response: result} shape when emitted in doSSE
    _setUserMemory(id, org, usermemory);
}

exports.emitThought = (id, org, messageID, thought) => {
    const usermemory = _getUserMemory(id, org);
    if (!usermemory.thoughts) usermemory.thoughts = {}; 
    usermemory.thoughts[messageID] = [...(usermemory.thoughts[messageID]||[]), thought];
    _setUserMemory(id, org, usermemory);
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

const _setUserMemory = (id, org, usermemory) => { 
    const memory = MEM_TO_USE.get(EVENTS_KEY, {}); 
    memory[_getmemkey(id, org)] = usermemory; 
    MEM_TO_USE.set(EVENTS_KEY, memory); 
}
const _getUserMemory = (id, org) => { 
    const memory = MEM_TO_USE.get(EVENTS_KEY, {});
    if (!memory[_getmemkey(id, org)])  memory[_getmemkey(id, org)] = {}; 
    return memory[_getmemkey(id, org)]; 
}
const _getmemkey = (id, org) => `${id}_${org}`;