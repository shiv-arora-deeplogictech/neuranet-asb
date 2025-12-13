/**
 * LLM history based chat for Enterprise AI.
 * 
 * Request params
 * 	id - The user ID
 *  org - User's Org
 *  session_id - The session ID for a previous session if this is a continuation
 *  prompt - The chat prompt
 *  brainid - The brain ID
 *  <anything else> - Used to expand the prompt, including user's queries
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

/**
 * Runs the LLM. 
 * 
 * @param {Object} params Request params documented below
 * 	                          id - The user ID
 *                            org - User's Org
 *                            session_id - The session ID for a previous session if this is a continuation
 *                            prompt - The chat prompt
 *                            <anything else> - Used to expand the prompt, including user's queries
 * @param {Object} _llmstepDefinition Not used.
 * 
 * @returns {Object} The Response is an object
 *  	                 result - true or false
 *  	                 reason - set to one of the reasons if result is false
 *  	                 response - the AI response, as a plain text
 *  	                 session_id - the session ID which can be used to ask backend to maintain sessions
 *  	                 metadatas - the response document metadatas. typically metadata.referencelink points
 * 					                 to the exact document
 */
exports.answer = params => {
	const docchat = NEURANET_CONSTANTS.getPlugin("llmdocchat");
	return docchat.answer(params);
}
