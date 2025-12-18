/**
 * Helper for Markdown conversions.
 * 
 * (C) 2025 TekMonks. All rights reserved.
 */

const {marked} = require("marked");

exports.md2html = (md) => marked(md);
exports.md2text = (md) => _decodeHTMLEntities(exports.md2html(md).replace(/<[^>]*?>/g, ''));

function _decodeHTMLEntities(text) {
    const htmlEntities = [ ['amp', '&'], ['apos', '\''], ['#x27', '\''], ['#x2F', '/'], ['#39', '\''], 
        ['#47', '/'], ['lt', '<'], ['gt', '>'], ['nbsp', ' '], ['quot', '"'] ];
    let retText = text; for (let i = 0; i < htmlEntities.length; ++i) retText = retText.replaceAll("&"+htmlEntities[i][0]+";", htmlEntities[i][1]);
    return retText;
}


if (require.main === module) {
    const args = process.argv.slice(2); 

	if (args.length < 2 || (!module.exports[args[0].toLowerCase()])) {
		console.log("Usage: mdconverter <md2html|md2text> <path to the markdown file or text itself>");
		process.exit(1);
	}

    const conversion = args[0].toLowerCase(), filepathOrMDText = args[1];
    let mdText = filepathOrMDText; if (filepathOrMDText.length < 256) try {mdText = require("fs").readFileSync(filepathOrMDText, "utf8")} catch (err) {}
    console.log(module.exports[conversion](mdText));
}