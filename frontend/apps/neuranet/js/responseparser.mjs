/** 
 * Library for converting rich responses to markdown.
 * 
 * (C) 2025 Tekmonks Corp.
 */

import {i18n} from "/framework/js/i18n.mjs";
import {router} from "/framework/js/router.mjs";

async function parseAIResponse(aiResult, chatbox, template) {
    if (!template) template = await i18n.get("AIResponseTemplate");
    if (!aiResult.jsonResponse) aiResult.jsonResponse = {response: aiResult.response};  // handle simple results here

    // handle references
    const references=[]; for (const metadata of (aiResult.metadatas||[])) if (!references.includes(
        decodeURIComponent(metadata.referencelink))) references.push(decodeURIComponent(metadata.referencelink));
    if (references.length) aiResult.jsonResponse.references = references;

    // render the text of the final response as MD
    const rendered = (await router.getMustache()).render(template, {
        response: aiResult.jsonResponse.response, references: aiResult.jsonResponse.references});

    // add collapsible section for internal code etc
    if (aiResult.jsonResponse.analysis_code) {
        const collapsibleSection = chatbox.getCollapsibleSection(await i18n.get("AIResponseAnalysisLabel"), 
            `\`\`\`${aiResult.jsonResponse.code_language.toLowerCase()}\n${aiResult.jsonResponse.analysis_code}\n\`\`\`\n`);
        rendered = collapsibleSection + rendered;  
    }

    return rendered;
}

export const responseparser = {parseAIResponse};