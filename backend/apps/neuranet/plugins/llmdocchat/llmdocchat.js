/**
 * LLM history based chat for Enterprise AI.
 * 
 * The Response is an object
 *  result - true or false
 *  reason - set to one of the reasons if result is false
 *  response - the AI response, as a plain text
 *  session_id - the session ID which can be used to ask backend to maintain sessions
 *  metadatas - the response document metadatas. typically metadata.referencelink points
 * 				to the exact document
 * 
 * (C) 2023 TekMonks. All rights reserved.
 */

const mustache = require("mustache");
const {Readable} = require("stream");
const serverutils = require(`${CONSTANTS.LIBDIR}/utils.js`);
const llmchat = require(`${NEURANET_CONSTANTS.LIBDIR}/llmchat.js`);
const chatsessionmod = require(`${NEURANET_CONSTANTS.LIBDIR}/chatsession.js`);
const textextractor = require(`${NEURANET_CONSTANTS.LIBDIR}/textextractor.js`);
const llmflowrunner = require(`${NEURANET_CONSTANTS.LIBDIR}/llmflowrunner.js`);
const neuranetutils = require(`${NEURANET_CONSTANTS.LIBDIR}/neuranetutils.js`);
const langdetector = require(`${NEURANET_CONSTANTS.THIRDPARTYDIR}/langdetector.js`);

const REASONS = llmflowrunner.REASONS;

/**
 * Runs the LLM. 
 * 
 * @param {Object} params Request params documented below
 * 	                          id - The user ID
 *                            org - User's Org
 *                            session_id - The session ID for a previous session if this is a continuation
 *                            prompt - The chat prompt
 *                            question - The question asked
 * 							  files - Attached files to the question
 * 							  aiappid - The AI app ID
 * 							  auto_summary - Set to true to reduce session size but can cause response errors
 * 							  model - The chat model to use, with overrides
 * 							  documents - Documents to use for the chat
 * 							  matchers_for_reference_links - The matchers for reference links
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
exports.answer = async (params) => {
	const id = params.id, org = params.org, params_session_id = params.session_id, query_in = params.query, 
		aiappid = params.brainid||params.aiappid;

	LOG.debug(`Got llm document chat request for query ${query_in} from ID ${id} of org ${org}.`);

	if (!(await llmchat.check_quota(id, org, aiappid))) {
		LOG.error(`Disallowing the LLM chat call, as the user ${id} is over their quota.`);
		return {reason: REASONS.LIMIT, ...CONSTANTS.FALSE_RESULT};
	}

	const {aiModelObject} = await llmchat.getAIModelAndObjectKeyAndLibrary(params.model, id, org, aiappid),
		aiModelObjectForChat = aiModelObject;	if (!aiModelObjectForChat) {LOG.error("Bad AI Library or model"); return {reason: REASONS.BAD_MODEL, ...CONSTANTS.FALSE_RESULT}}
	const {sessionID} = chatsessionmod.getUsersChatSession(id, params_session_id);

	const languageDetectedForQuestion =  langdetector.getISOLang(params.question);

	const validateDocumentsOrFiles = (fileOrDocArray) => fileOrDocArray && fileOrDocArray.length !=0;
	const documentResultsForPrompt = params.documents;	// if no documents found, short-circuit with no knowledge error
	if ((!validateDocumentsOrFiles(documentResultsForPrompt)) && (!validateDocumentsOrFiles(params.files))) {
		const errMsg = "No knowledge of this topic."; LOG.error(errMsg); 
		params.return_error(errMsg, REASONS.NOKNOWLEDGE); return;
	}
	
	const documentsForPrompt = [], metadatasForResponse = []; 
	if(validateDocumentsOrFiles(documentResultsForPrompt)) for (const [i,documentResult] of documentResultsForPrompt.entries()) {
		documentsForPrompt.push({content: documentResult.text, document_index: i+1}); 
		const metadataThis = serverutils.clone(documentResult.metadata);
		if (params.matchers_for_reference_links && metadataThis[NEURANET_CONSTANTS.REFERENCELINK_METADATA_KEY]) 
				for (const matcher of params.matchers_for_reference_links) { 
			let reflink = metadataThis[NEURANET_CONSTANTS.REFERENCELINK_METADATA_KEY], match = reflink.match(new RegExp(matcher));
			if (match) metadataThis[NEURANET_CONSTANTS.REFERENCELINK_METADATA_KEY] = match.slice(1).join("/");
		}
		metadatasForResponse.push(metadataThis) 
	};
	let filesForPrompt = await exports.getFilesForPrompt(params.files);
	const knowledgebasePromptTemplate =  params[`prompt_${languageDetectedForQuestion}`] || params.prompt;
	const knowledegebaseWithQuestion = mustache.render(
		knowledgebasePromptTemplate, {...params, documents: documentsForPrompt, files: filesForPrompt}).trim();

	const paramsChat = { id, org, maintain_session: true, session_id: sessionID, model: aiModelObjectForChat,
        session: [{"role": aiModelObjectForChat.user_role, "content": knowledegebaseWithQuestion}],
		auto_chat_summary_enabled: params.auto_summary||false, raw_question: query_in, aiappid };
	const response = await llmchat.chat(paramsChat);

	return {...response, metadatas: metadatasForResponse};
}

exports.getFilesForPrompt = async paramFiles => {
	const validateDocumentsOrFiles = (fileOrDocArray) => fileOrDocArray && fileOrDocArray.length !=0;

	let filesForPrompt = undefined; if (validateDocumentsOrFiles(paramFiles)) for (const file of paramFiles) {
		const textsteam = await textextractor.extractTextAsStreams(Readable.from(Buffer.from(file.bytes64, "base64")), file.filename);
		const text = await neuranetutils.readFullFile(textsteam, "utf8");
		if (text) {
			if (!filesForPrompt) filesForPrompt = []; 
			filesForPrompt.push({filename: file.filename, text}); 
			const metadataForReferenceThisFile = {}; 
			metadataForReferenceThisFile[NEURANET_CONSTANTS.REFERENCELINK_METADATA_KEY] = file.filename;
			metadatasForResponse.push(metadataForReferenceThisFile);
		}
	}
}