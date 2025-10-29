export const i18n = {
"Title" : "Neuranet",
"logintagline": "Enterprise AI Neural Networks",
"loginsubtag": "Intelligent, integrated, and easy to use.",
"LoginMsg": "Sign in with Tekmonks",
"LoginFailed": "Login failed",
"LearnMore": "Learn more",
"Timeout_Error": "You have been logged out due to inactivity",
"Relogin": "Relogin here",

"NothingToConvert": "Found nothing to convert.",
"ErrorConvertingInternal": "Error in conversion, sorry.",
"ErrorConvertingBadAIModel": "Error in conversion, due to an AI model mismatch, sorry.",
"ErrorConvertingBadAPIRequest": "Error in conversion, due to network communication error, sorry.",
"ErrorConvertingBadInputSQL": "Error in conversion, due to bad input SQL.\n\n{{#message}}{{message}}{{/message}}{{^message}}SQL parser failed to parse.{{/message}}\n\nFound at: Line:{{#line}}{{line}}{{/line}}{{^line}}0{{/line}}, Column:{{#column}}{{column}}{{/column}}{{^column}}0{{/column}}.",
"PossibleErrorConvertingSQL": "--- WARNING: Possibly bad SQL.\n--- {{#message}}{{{message}}}{{/message}}{{^message}}SQL parser failed to parse.{{/message}}\n--- Found at: {{#line}}{{line}}{{/line}}{{^line}}0{{/line}}, Column:{{#column}}{{column}}{{/column}}{{^column}}0{{/column}}.\n",
"InternalErrorConverting": "Internal error, please retry later.",
"ValidateSQL": "Prevalidate input",
"ValidateSQLWarning": "Checking this will most probably generate validation errors unless the SQL is pure SQL:2016 compliant (most are not).",

"ChooseActivity": "Choose Activity",

"ChatAIError": "AI error in processing. Please reload the page to start a new conversation.",
"NeuralNetReady": "AI Neural Network<br>Ready...",
"TypeMessage": "Type Message",
"Multiline": "Multiline",
"MaxSizeError": "Please attach a file smaller than 4 MB.",
"MaxAttachmentsError": "Maximum of 4 files can be attached.",

"ViewLabel_gencode": "Generate code",
"ViewLabel_enterpriseassist": "Enterprise assistant",
"ViewLabel_sqltranslate": "Translate SQL",
"ViewLabel_chat": "General chat",
"ViewLabel_aiworkshop": "AI workshop",


"ErrorConvertingBadInputCode": "Error in conversion, due to bad input code.\n\n{{#message}}{{message}}{{/message}}{{^message}}Code parser failed to parse.{{/message}}\n\nFound at: Line:{{#line}}{{line}}{{/line}}{{^line}}0{{/line}}, Column:{{#column}}{{column}}{{/column}}{{^column}}0{{/column}}.",
"PossibleErrorConvertingCode": "--- WARNING: Possibly bad code.\n--- {{#message}}{{message}}{{/message}}{{^message}}Code parser failed to parse.{{/message}}\n--- Found at: {{#line}}{{line}}{{/line}}{{^line}}0{{/line}}, Column:{{#column}}{{column}}{{/column}}{{^column}}0{{/column}}.",

"ErrorConvertingAIQuotaLimit": "Your 24 hour spend quota limit has been reached. Please retry tomorrow.",

"NotImplemented": "Not implemented yet.",

"EnterpriseAssist_Done": "Done",
"EnterpriseAssist_Processing": "Reading",
"EnterpriseAssist_NoEvents": "No Events.",
"EnterpriseAssistAnalysisLabel": "Analysis",
"EnterpriseAssist_KnowledgeBase": "AI Training",
"EnterpriseAssist_ErrorNoKnowledge": "Sorry I have no knowledge of this topic.",
"EnterpriseAssist_AIError": "AI error in processing. Please reload the page to start a new assistant request.",
"EnterpriseAssist_ResponseTemplate": "{{{response}}}\n\n<span id='aireferences' style='font-size: x-small; line-height: 1.2em;'><span style='font-style: italic'>References</span><br/>\n{{#references}}{{.}}<br/>\n{{/references}}<span>",

"AIWorkshop_Title": "AI Workshop",
"AIWorkshop_Subtitle_EditApp": "Editing {{{aiappid}}}",
"AIWorkshop_Subtitle_TrainApp": "Training {{{aiappid}}}",
"AIWorkshop_NewAIApp": "New",
"AIWorkshop_TrainAIApp": "Train",
"AIWorkshop_DeleteAIApp": "Delete",
"AIWorkshop_PublishAIApp": "Publish",
"AIWorkshop_UnpublishAIApp": "Unpublish",
"AIWorkshop_AIAppNamePrompt": "Enter AI Application Name",
"AIWorkshop_AIAppGenericError": "Error in AI application",
"AIWorkshop_AIAppGenericSuccess": "Command succeeded",
"AIWorkshop_AIAppAlreadyExists": "Error an app by that ID already exists",
"AIWorkshop_NotAdmin": "You do not have required permissions. Please contact your administrator.",
"AIWorkshop_ClickAppToEdit": "Click to edit",
"AIWorkshop_KnowledgeBase": "AI Training",
"AIWorkshop_TemplateLabel": "Select template"
}