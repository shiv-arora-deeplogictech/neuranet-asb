/**
 * Searches for the documents or text extracts given a query.
 * 
 * (C) 2023 TekMonks. All rights reserved.
 */

exports.find = async function(searchStrategy, id, org, query, aimodelToUse, lang="en") {
    const searchPlugin = NEURANET_CONSTANTS.getPlugin(searchStrategy);
    if (searchPlugin) return await searchPlugin.search(id, org, query, aimodelToUse, lang);
}