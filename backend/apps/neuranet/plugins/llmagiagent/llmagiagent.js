/**
 * LLM based AGI agent for autonomous workflows (thinking). Will give the answer 
 * and run Python code to produce the answer if needed. Currently max steps is 2:
 * answer if LLM gave the answer or run code to produce the answer if LLM gave the code.
 * Can however loop if code doesn't compile or work (max retries).
 * 
 * Response object
 *  result - true or false
 *  reason - set to one of the reasons if result is false
 *  response - the AI response, as a plain text
 *  session_id - the session ID which can be used to ask backend to maintain sessions
 * 
 * (C) 2024 TekMonks. All rights reserved.
 */

const os = require("os");
const path = require("path");
const fspromises = require("fs").promises;
const utils = require(`${CONSTANTS.LIBDIR}/utils.js`);
const simplellm = require(`${NEURANET_CONSTANTS.LIBDIR}/simplellm.js`);
const llmflowrunner = require(`${NEURANET_CONSTANTS.LIBDIR}/llmflowrunner.js`);

const REASONS = llmflowrunner.REASONS, MAX_RETRIES = 3;
const KEYWORD_TO_LINE_WORDS_RATIO = 6, LINES_OF_CODE_TO_TOTAL_LINE_RATIO = 0.7;

/**
 * Runs the LLM. 
 * 
 * @param {Object} params Request params documented below
 * 	                          id - The user ID
 *                            org - User's Org
 *                            session_id - The session ID for a previous session if this is a continuation
 *                            question - The question asked
 * 							  files - Attached files to the question
 * 							  aiappid - The AI app ID
 * 							  auto_summary - Set to true to reduce session size but can cause response errors
 * 							  model - The chat model to use, with overrides
 * 							  documents - Documents to use for the chat
 * 							  matchers_for_reference_links - The matchers for reference links
 * 							  prompt - The prompt for the initial question
 *  						  prompt_code_exec_failed - The code step's exec failed, prompt for regenerating it
 *  						  prompt_code_compile_failed - The code step's compile failed, prompt for regenerating it
 *  						  prompt_code_retry_exceeded - The code step's compile or exec failed, prompt for informing of the failure
 *  						  code_max_retries - How many times to retry generating the code, if it fails exec or compiles
 *                            <anything else> - Used to expand the prompt, including user's queries
 * 
 * @returns {Object} The Response is an object
 *  	                 result - true or false
 *  	                 reason - set to one of the reasons if result is false
 *  	                 response - the AI response, as a plain text
 *  	                 session_id - the session ID which can be used to ask backend to maintain sessions
 *  	                 metadatas - the response document metadatas. typically metadata.referencelink points
 * 					                 to the exact document
 */
exports.answer = async params => {
	if (!validateRequest(params)) {LOG.error("Validation failure."); return {reason: REASONS.VALIDATION, ...CONSTANTS.FALSE_RESULT};}

	LOG.debug(`Got AGI agent request from ID ${params.id}. Incoming request is ${JSON.stringify(params)}`);
	const docchat = NEURANET_CONSTANTS.getPlugin("llmdocchat");	

	let stepAnswer = await docchat.answer(params), retries = 0; 
	if (params.has_error() || (!stepAnswer.result)) 
		return params.has_error()?undefined:{result: false, reason: REASONS.INTERNAL};	// error in processing chat response

	let extractedPythonCode = false;
	const _retry = async (prompt, error) => {
		retries++; stepAnswer = await docchat.answer({...params, prompt, currentCode: extractedPythonCode, error}); 
		if (!params.has_error()) extractedPythonCode = _extractPythonCode(params, stepAnswer.response);
	};

	extractedPythonCode = _extractPythonCode(params, stepAnswer.response);
	while (extractedPythonCode && (retries < (params.code_max_retries||MAX_RETRIES))) {
		const compileResult = await _compiles(extractedPythonCode);
		if (compileResult.result) {
			const execResult = await _execCode(extractedPythonCode, params);
			if (execResult.result) {
				stepAnswer.response = execResult.stdout; 
				stepAnswer.jsonResponse = {analysis_code: extractedPythonCode, response: execResult.stdout, code_language: "Python"}; break;
			} else await _retry(params.prompt_code_exec_failed, execResult.stderr);
		} else await _retry(params.prompt_code_compile_failed, compileResult.stderr);
		if (params.has_error() || (!stepAnswer.result)) 
			return params.has_error()?undefined:{result: false, reason: REASONS.INTERNAL};	// error in processing chat response
	}
	if (retries >= 3) stepAnswer = await _doFailedResponse(params, stepAnswer);
	
	return stepAnswer;
}

async function _doFailedResponse(params, stepAnswer) {
	const llmerrorMessage = await simplellm.prompt_answer(params.prompt_code_retry_exceeded, 
		params.id, params.org, params.aiappid, {question: params.question}, params["model-simplellm"].name);
	return {...stepAnswer, response: llmerrorMessage, jsonResponse: undefined};
}

async function _compiles(code) {
	if (!code) return false;
	const tmpPyFile = utils.getTempFile("py"); await fspromises.writeFile(tmpPyFile, code, "utf8");
	const result = await utils.exec(NEURANET_CONSTANTS.CONF.python_path, ["-m", "py_compile", tmpPyFile], "utf8");
	return result;
}

async function _execCode(code, params) {
	let codeToExec = code, tmpPaths = [];
	if (params.files) for (const file of params.files) {
		const tmpPath = os.tmpdir() + "/" + path.basename(file.filename).split(".").slice(0, -1).join(".") + "." + Date.now() + path.extname(file.filename);
		await fspromises.writeFile(tmpPath, Buffer.from(file.bytes64, "base64"));
		const regExpToReplace = new RegExp(`${params.tmp_dir_name}/*?${file.filename}`, "g");
		codeToExec = codeToExec.replaceAll(regExpToReplace, tmpPath);
		tmpPaths.push(tmpPath);
	}
	const tmpPyFile = utils.getTempFile("py"); await fspromises.writeFile(tmpPyFile, codeToExec, "utf8");

	const result = await utils.exec(NEURANET_CONSTANTS.CONF.python_path, tmpPyFile, "utf8");

	/*
	try {fspromises.rm(tmpPyFile); for (const tmpPath of tmpPaths) fspromises.rm(tmpPath);} 
	catch(err) {LOG.warn(`Unable to delete user temporary chat files ${tmpPaths.join(" ")} and/or ${tmpPyFile}`);}
	*/
	
	return result;
}

function _extractPythonCode(params, text) {
	if ((!text) || (typeof text !== "string") || (text.trim() == '')) return false;

	// Normalize line endings and trim
	const lines = text.trim().replace(/^\s*#.*$/gm, "").replace(/^\s*\n/gm, "").split(/\r?\n/);
	if (lines.length === 0) return false;

	// Check for markdown code block
	const isMarkdownPythonBlock = text.startsWith('```python') || text.includes('```python\n');
	if (isMarkdownPythonBlock) {
		const code = text.substring(text.indexOf('```python')+'```python'.length, text.lastIndexOf('```')).trim();
		return code;
	}

	// Common Python keywords
	const pythonKeywords = ['def', 'import', 'from', 'class', 'for', 'while', 'if', 'elif', 'else',
		'return', 'try', 'except', 'with', 'as', 'pass', 'break', 'continue', 'lambda', 'yield', 'global',
		'nonlocal', 'assert', 'raise','abs', 'aiter', 'all', 'anext', 'any', 'ascii', 'bin', 'bool', 
		'breakpoint', 'bytearray', 'bytes', 'callable', 'chr', 'classmethod', 'compile', 'complex', 
		'delattr', 'dict', 'dir', 'divmod', 'enumerate', 'eval', 'exec', 'exit', 'filter', 'float', 
		'format', 'frozenset', 'getattr', 'globals', 'hasattr', 'hash', 'hex', 'id', 'input', 'int', 
		'isinstance', 'issubclass', 'iter', 'len', 'list', 'locals', 'map', 'max', 'memoryview', 
		'min', 'next', 'object', 'oct', 'open', 'ord', 'pow', 'print', 'property', 'quit', 'range', 
		'repr', 'reversed', 'round', 'set', 'setattr', 'slice', 'sorted', 'staticmethod', 'str', 'sum', 
		'super', 'tuple', 'type', 'vars', 'zip']; 

	let code='', pythonCodeLikeLines = 0, expressionChecker1 = new RegExp(".+\\s*=\\s*.+"),
		expressionChecker2 = new RegExp(".+\\..+\\(.*\\)");	// Count keyword matches
	for (const line of lines) {
		let thisLineAdded = false;
		if (expressionChecker1.test(line)) {thisLineAdded = true; code += `${line}\n`; pythonCodeLikeLines++;}	// possible assignment or calculation expression
		if (expressionChecker2.test(line) && (!thisLineAdded)) {thisLineAdded = true; code += `${line}\n`; pythonCodeLikeLines++;}	// possible object expression

		const keywordsToWordsInLineThreshold = Math.floor(line.split(/\s+/).length/KEYWORD_TO_LINE_WORDS_RATIO);
		let keywordsFoundInTheLine = 0; 
		if (!thisLineAdded) for (const kw of pythonKeywords) {
			const regex1 = new RegExp(`\\b${kw}\\b`), regex2 = new RegExp(`\\b${kw}\\(.+\\)`)
			if (regex1.test(line.trim())) keywordsFoundInTheLine++;
			if ((keywordsFoundInTheLine > keywordsToWordsInLineThreshold) && (!thisLineAdded)) {
				pythonCodeLikeLines++; thisLineAdded = true; code += `${line}\n`;
			}
      if ((!thisLineAdded) && regex2.test(line.trim())) {pythonCodeLikeLines++; thisLineAdded = true; code += `${line}\n`;};
		}
	}

	const threshold = Math.floor(lines.length*(params.line_to_code_ratio||LINES_OF_CODE_TO_TOTAL_LINE_RATIO));	
	if (pythonCodeLikeLines >= threshold) return code; else return false;
}

const validateRequest = params => (params && params.id && params.org && params.question && params.aiappid);