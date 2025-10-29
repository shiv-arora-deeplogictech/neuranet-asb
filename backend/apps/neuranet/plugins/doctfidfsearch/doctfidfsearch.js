/**
 * This strategy is to first find matching documents using NN's TF.IDF and 
 * then split them into context sized pieces and perform a second level TD.IDF
 * search on the chunks for the top chunks. This strategy works good in general
 * for all languages as long as cross-language search is not needed. 
 * 
 * @returns search returns array of {metadata, text} objects matching the 
 * 			resulting documents. The texts are shards of the document of
 * 			context length specified in the embedding generation model which
 * 			was used to ingest the documents.
 * 
 * (C) 2023 TekMonks. All rights reserved.
 */

const aiapp = require(`${NEURANET_CONSTANTS.LIBDIR}/aiapp.js`);
const fileindexer = require(`${NEURANET_CONSTANTS.LIBDIR}/fileindexer.js`);
const textsplitter = require(`${NEURANET_CONSTANTS.LIBDIR}/textsplitter.js`);
const brainhandler = require(`${NEURANET_CONSTANTS.LIBDIR}/brainhandler.js`);
const llmflowrunner = require(`${NEURANET_CONSTANTS.LIBDIR}/llmflowrunner.js`);
const langdetector = require(`${NEURANET_CONSTANTS.THIRDPARTYDIR}/langdetector.js`);

const REASONS = llmflowrunner.REASONS, TEMP_MEM_TFIDF_ID = "_com_tekmonks_neuranet_tempmem_tfidfdb_id_";

/**
 * Searches the AI DBs for the given query. Strategy is documents are searched
 * first using keyword search, then for the top matching documents, vector shards
 * are returned for the relevant portions of the document which can answer the
 * query.
 * 
 * @param params Contains the following properties
 * 							id The ID of the logged in user 
 * 							org The org of the logged in user's org
 * 							query The query to search for
 * 							brainid The AI application ID for the DB to search
 *                          topK_tfidf TopK for TD-IDF search
 *                          cutoff_score_tfidf Cutoff score for TF-IDF
 *                          topK_vectors TopK for vector search
 * 							autocorrect_query Default is true, set to false to turn off
 * 							punish_verysmall_documents If true smaller documents rank lower
 * 							bm25 If true BM25 adjustment is made to the rankings
 * @param {Object} _llmstepDefinition Not used, optional.
 * 
 * @returns The search returns array of {metadata, text} objects matching the 
 * 			resulting documents. The texts are shards of the document of
 * 			context length specified in the embedding generation model which
 * 			was used to ingest the documents.
 */
exports.search = async function(params, _llmstepDefinition) {
	const id = params.id, org = params.org, query = params.query, primaryAIAppID = params.aiappid,
		brainids = params.bridges ? (Array.isArray(params.bridges)?params.bridges:[params.bridges]) : [params.aiappid];
	const autoCorrectQuery = params.autocorrect_query !== undefined ? params.autocorrect_query : true;
	const topK_tfidf = params.topK * 10, topK_final = params.topK;
	const cutoff_score_tfidf = params.cutoff_score_tfidf;
	const tfidfSearchOptions = {punish_verysmall_documents: params.punish_verysmall_documents||false, 
		ignore_coord: params.ignore_coord, max_coord_boost: params.max_coord_boost, bm25: params.bm25||false};

	const nntfidfdbPlugin = NEURANET_CONSTANTS.getPlugin("nntfidfdb");
    const tfidfDBs = []; for (const brainidThis of brainids) tfidfDBs.push(...await nntfidfdbPlugin.getTFIDFDBsForIDAndOrgAndBrainID(id, org, brainidThis));
	if (!tfidfDBs.length) {	// no TF.IDF DB worked or found
		const errMsg = `Can't instantiate any TF.IDF DBs user ID ${id}. Giving up.`;
		params.return_error(errMsg, REASONS.INTERNAL); return;
	}
	let tfidfScoredDocuments = []; 
	for (const tfidfDB of tfidfDBs) { 
		const searchResults = await tfidfDB.query(query, topK_tfidf, params.metadata_filter_function, cutoff_score_tfidf, 
			tfidfSearchOptions, undefined, autoCorrectQuery);
		if (searchResults && searchResults.length) {
			const searchResultsWithAIAppIDAdded = searchResults.map(result=>{result.aiappid = tfidfDB.aiappid; return result;})
			tfidfScoredDocuments.push(...searchResultsWithAIAppIDAdded);
		} else LOG.warn(`No TF.IDF search documents found for query ${query} for id ${id} org ${org} and brainid ${brainids}.`);
	}
	if (tfidfScoredDocuments.length == 0) return _formatResults(params, []);	// no knowledge

	// now split them into chunks, as LLMs can't take in entire documents, a-la simulated vector embedding search 
	// using TF.IDF under the covers
	const embeddingsModel = await aiapp.getAIModel(params.embeddings_model.name, params.embeddings_model.model_overrides, id, org, primaryAIAppID);
	const dummyVectorResults = []; for (const tfidfScoredDoc of tfidfScoredDocuments) {
		const extrainfo = brainhandler.createExtraInfo(id, org, tfidfScoredDoc.aiappid, tfidfScoredDoc.metadata);
		const textThisDoc = (await fileindexer.getTextContents(id, org, tfidfScoredDoc.metadata.fullpath, extrainfo)).toString('utf8');
		const langDetected = langdetector.getISOLang(textThisDoc);
        const split_separators = embeddingsModel.split_separators[langDetected] || embeddingsModel.split_separators["*"];
		const chunk_size = params.chunk_size || embeddingsModel.vector_chunk_size[langDetected] || embeddingsModel.vector_chunk_size["*"];
		for (const split of textsplitter.getSplits(textThisDoc, chunk_size, split_separators)) 
			dummyVectorResults.push({text: split, metadata: tfidfScoredDoc.metadata});
	}
	if ((!dummyVectorResults) || (!dummyVectorResults.length)) return _formatResults(params, []);	// no knowledge

	// re-rank by a second level TF.IDF on the chunks by creating an in-memory temporary TF.IDF DB 
	// to search for relevant document fragments
	const tfidfDBInMem = await nntfidfdbPlugin.getInMemTFIDFDB(TEMP_MEM_TFIDF_ID+Date.now());
	for (const vectorResult of dummyVectorResults) {
		const uniqueID = (Date.now() + Math.random()).toString().split(".").join(""); vectorResult.metadata.__uniqueid = uniqueID;
		const temporaryMetadata = {...(vectorResult.metadata)}; temporaryMetadata[NEURANET_CONSTANTS.NEURANET_DOCID]  = uniqueID;
		await tfidfDBInMem.create(vectorResult.text, temporaryMetadata); 
	} 
	const tfidfSearchResultsTopK = await tfidfDBInMem.query(query, topK_final, undefined, undefined, {noidf: true});
	tfidfDBInMem.free_memory();

	const searchResultsTopK = []; for (const tfidfSearchResultTopKThis of tfidfSearchResultsTopK) 
		searchResultsTopK.push(...(dummyVectorResults.filter(vectorResult => vectorResult.metadata.__uniqueid == tfidfSearchResultTopKThis.metadata.__uniqueid)));
    
    return _formatResults(params, searchResultsTopK);
}

function _formatResults(params, searchResultsTopK) {
	const searchResults = []; for (const searchResultTopKThis of searchResultsTopK) 
		if (!params.request.llm_format) searchResults.push({text: searchResultTopKThis.text, metadata: searchResultTopKThis.metadata});
		else searchResults.push(searchResultTopKThis.text);
    return params.request.llm_format?searchResults.join("\n\n"):searchResults;
}