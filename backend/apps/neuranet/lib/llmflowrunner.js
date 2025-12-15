/**
 * Runs AI app's LLM flows.
 * 
 * (C) 2023 Tekmonks Corp. All rights reserved.
 * License: See the enclosed LICENSE file.
 */

const mustache = require("mustache");
const serverutils = require(`${CONSTANTS.LIBDIR}/utils.js`);
const aiapp = require(`${NEURANET_CONSTANTS.LIBDIR}/aiapp.js`);

const DEFAULT_OUT = "lastLLMFlowStepOutput", CONDITION_JS = "condition_js", CONDITION = "condition", 
    NOINFLATE = "_noinflate", JSCODE = "_js";
const SPECIAL_KEY_SUFFIXES = [NOINFLATE, JSCODE];

/** Response reasons for LLM flows */
exports.REASONS = {INTERNAL: "internal", BAD_MODEL: "badmodel", OK: "ok", VALIDATION:"badrequest", 
    LIMIT: "limit", NOKNOWLEDGE: "noknowledge", NOTCHATAI: "notchatai"};

exports.DEFAULT_LLM_FLOW = "llm_flow";

/**
 * Runs LLM flows that generate the final answer to a query.
 * @param {string} query The incoming query
 * @param {string} id The ID of the user
 * @param {string} org The org of the user
 * @param {string} aiappid The AI app requested
 * @param {Object} request The incoming request params
 * @returns {Object} Final answer as {result: true|false,  response: set if result is true,error: set if result is false}. 
 */
exports.answer = async function(query, id, org, aiappid, request, flow_section=exports.DEFAULT_LLM_FLOW) {
    const working_memory = {
        __error: false, __error_message: "", __error_reason: exports.REASONS.OK, query, id, org, 
        aiappdir: aiapp.getAppDir(id, org, aiappid), queryJSON: JSON.stringify(query), aiappid, request, 
        return_error: function(message, reason, working_memory) {
            working_memory.__error = true; working_memory.__error_message = message; LOG.error(message); 
            working_memory.__error_reason = reason; 
        }
    };

    let llmflowCommands; try {llmflowCommands = await aiapp.getAIAppObject(id, org, aiappid, flow_section)} catch (err) {
        return {...CONSTANTS.FALSE_RESULT, error: `Error parsing app for ${aiappid}`, reason: exports.REASONS.INTERNAL};
    }

    for (const llmflowCommandDefinition of llmflowCommands) {
        if (llmflowCommandDefinition[CONDITION]||llmflowCommandDefinition[CONDITION_JS]) 
            llmflowCommandDefinition[CONDITION] = await _expandLLMFlowParam(llmflowCommandDefinition[CONDITION]?CONDITION:CONDITION_JS,
                llmflowCommandDefinition[CONDITION]||llmflowCommandDefinition[CONDITION_JS], working_memory);
        if (llmflowCommandDefinition[CONDITION] !== undefined && (!llmflowCommandDefinition[CONDITION])) continue;  

        const [command, command_function] = llmflowCommandDefinition.command.split(".");
        const llmflowModule = await aiapp.getCommandModule(id, org, aiappid, command);
        const callParams = {id, org, query, aiappid, request, 
            return_error: function(){working_memory.return_error(...arguments, working_memory)},
            has_error: function(){return working_memory.__error}}; 
        for (const [key, value] of Object.entries(llmflowCommandDefinition.in)) // expand params to get call params
            callParams[exports.extractRawKeyName(key)] = await _expandLLMFlowParam(key, value, working_memory);

        try {
            const flow_response = await llmflowModule[command_function||aiapp.DEFAULT_ENTRY_FUNCTIONS.llm_flow](
                callParams, llmflowCommandDefinition);
            if (working_memory.__error) break;
            serverutils.setObjProperty(working_memory, (llmflowCommandDefinition.out||DEFAULT_OUT), flow_response);
        } catch (err) {
            working_memory.return_error(`Error running flow command ${command} for id ${id} and org ${org} and ai app ${aiappid}. The error is ${err.stack?err.stack.toString():err.toString()}`, exports.REASONS.INTERNAL, working_memory);
            break;
        }
    }

    if (!working_memory.__error) return {...CONSTANTS.TRUE_RESULT, ...(working_memory.airesponse||[])};
    else return {...CONSTANTS.FALSE_RESULT, error: working_memory.__error_message, reason: working_memory.__error_reason};
}   

async function _runJSCode(code, context) {
    try {return await (serverutils.createAsyncFunction(code)(context))} catch (err) {
        LOG.error(`Error running custom JS code error is: ${err}`); return false;
    }
}

async function _expandLLMFlowParam(key, value, working_memory) {
    let finalValue;
    if (key.endsWith(NOINFLATE)) finalValue = value;
    else if (key.endsWith(JSCODE)) finalValue = await _runJSCode(mustache.render(value.toString(), working_memory), 
        {NEURANET_CONSTANTS, require: function() {const module = require(...arguments); return module}, ...working_memory});
    else finalValue = typeof value === "object" ? JSON.parse(
        mustache.render(JSON.stringify(value), working_memory)) : typeof value === "string" ? 
        mustache.render(value.toString(), working_memory) : value;
    return finalValue;
}

exports.extractRawKeyName = key => {
    if (key.lastIndexOf("_") == -1) return key;
    const splits = key.split("_"), suffix = "_"+splits[splits.length-1], tentativeRawKey = splits.slice(0, splits.length-1).join("_");
    if (SPECIAL_KEY_SUFFIXES.includes(suffix)) return tentativeRawKey; else return key;
}
