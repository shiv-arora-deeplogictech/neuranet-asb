/**
 * Tests the vector DB and algorithms within it.
 * 
 * (C) 2023 Tekmonks. All rights reserved.
 */

const aidbfs = require(`${NEURANET_CONSTANTS.LIBDIR}/aidbfs.js`);
const aiutils = require(`${NEURANET_CONSTANTS.LIBDIR}/aiutils.js`);
const embedding = require(`${NEURANET_CONSTANTS.LIBDIR}/embedding.js`);

const topK = 5, minDistance = 0.5;

const TEST_ID = "test@tekmonks.com", TEST_ORG = "Tekmonks", SEARCH_MODEL_DEFAULT = "chat-openai",
    TEST_APP = require(`${__dirname}/conf/testing.json`).aiapp;

exports.runTestsAsync = async function(argv) {
    if ((!argv[0]) || (argv[0].toLowerCase() != "vectorsearch")) {
        LOG.console(`Skipping vector DB search test case, not called.\n`)
        return;
    }
    if (!argv[1]) {
        LOG.console("Missing query.\n");
        return;
    } 
    const multithreaded = (argv[2]||"").toLowerCase() == "multithreaded" ? true : false;
    const notext = (argv[3]||"").toLowerCase() == "notext" ? true : false;
    const benchmarkIterations = argv[4]?parseInt(argv[4]):undefined;

    const query = argv[1];
    LOG.console(`Test case for VectorDB search called with query ${query}.\n`);
   
    try {
        const query_vector = await _embeddingsGenerator(query);
        if (!query_vector) {LOG.console(`Query vector embedding generation failed. Test failed.\n`); return;}

        const vectorDB = (await aidbfs.getVectorDBsForIDAndOrg(TEST_ID, TEST_ORG, _embeddingsGenerator, multithreaded))[0];
        if (!vectorDB) {LOG.console(`Vector DB fetch failed. Test failed.\n`); return;}
        LOG.console(`Searching for ${query}, top ${topK} results with a minimum distance of ${minDistance}.\n`);
        const timeStart = Date.now();
        const results = await vectorDB.query(query_vector, topK, minDistance, undefined, notext, false, benchmarkIterations);
        const timeTaken = Date.now() - timeStart;

        for (const result of results) delete result.vector; // we don't want to show the massive result vectors
        LOG.console(`Results follow\n${JSON.stringify(results, null, 4)}\n`);
        LOG.console(`\nSearch took ${timeTaken} milliseconds.\n`);
    } catch (err) {
        LOG.console(`Error ${err} found. Test failed.\n`);
    }
}

const _embeddingsGenerator = async text => {
    const aiModelObjectForSearch = await aiutils.getAIModel(SEARCH_MODEL_DEFAULT);
    const response = await embedding.createEmbeddingVector(TEST_ID, TEST_ORG, TEST_APP, text, aiModelObjectForSearch.embeddings_model); 
    if (response.reason != embedding.REASONS.OK) return null;
    else return response.embedding;
}
