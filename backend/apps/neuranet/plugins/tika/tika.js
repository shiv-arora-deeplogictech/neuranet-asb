/**
 * Can return text from lots of different file types - uses Apache Tika. 
 * https://tika.apache.org/
 * 
 * Needs htmlparser2 NPM for HTML files.
 * 
 * (C) Apache.org - LICENSE - https://www.apache.org/licenses/LICENSE-2.0
 * 
 * (C) 2023 TekMonks. All rights reserved.
 * License: See the enclosed LICENSE file.
 */

const fs = require("fs");
const path = require("path");
const fspromises = fs.promises;
const crypto = require("crypto");
const stream = require("stream");
const process = require('process');
const mustache = require("mustache");
const {spawn} = require('node:child_process');
const {Ticketing} = require(`${CONSTANTS.LIBDIR}/ticketing.js`);
const neuranetutils = require(`${NEURANET_CONSTANTS.LIBDIR}/neuranetutils.js`);

const TIKA_TEMP_SUBDIR_WRITE = `${NEURANET_CONSTANTS.TEMPDIR}/tika/out`, 
    TIKA_TEMP_SUBDIR_READ = `${NEURANET_CONSTANTS.TEMPDIR}/tika/in`, 
    TIKA_TEMP_SUBDIR_TEMP = `${NEURANET_CONSTANTS.TEMPDIR}/tika/temp`,
    JAVA_CP_JOIN_CHAR = process.platform === "win32" ? ";" : ":", 
    JAVA_EXE = process.platform === "win32" ? "java.exe" : "java";

let tikaconf, initialized, htmlparser2, ticketing;

exports.initAsync = async _ => {
    try { 
        const _toUnixPath = pathIn => pathIn.split(path.sep).join(path.posix.sep);
        const jsonConfParsed = mustache.render(await fspromises.readFile(`${__dirname}/tika.json`, "utf8"), 
            {__dirname: _toUnixPath(__dirname), 
                java_home: `${_toUnixPath(NEURANET_CONSTANTS.CONF.java_home||process.env.JAVA_HOME)}/bin/${JAVA_EXE}`,
                env: process.env}); 
        tikaconf = JSON.parse(jsonConfParsed); 
    } catch (err) { LOG.error(`Can't read Tika configuration. The error was ${err}.`); throw err; }

    if (!ticketing) ticketing = new Ticketing(tikaconf.max_tika_instances);

    try { await fspromises.access(TIKA_TEMP_SUBDIR_READ); } catch (err) {
        if (err.code == "ENOENT") await fspromises.mkdir(TIKA_TEMP_SUBDIR_READ, {recursive: true});
        else {LOG.error(`Can't access temporary paths needed by Tika. The error was ${err}.`); throw err;}
    }
    try { await fspromises.access(TIKA_TEMP_SUBDIR_WRITE); } catch (err) { 
        if (err.code == "ENOENT") await fspromises.mkdir(TIKA_TEMP_SUBDIR_WRITE, {recursive: true});
        else {LOG.error(`Can't access temporary paths needed by Tika. The error was ${err}.`); throw err;}
    }
    try { await fspromises.access(TIKA_TEMP_SUBDIR_TEMP); } catch (err) { 
        if (err.code == "ENOENT") await fspromises.mkdir(TIKA_TEMP_SUBDIR_TEMP, {recursive: true});
        else {LOG.error(`Can't access temporary paths needed by Tika. The error was ${err}.`); throw err;}
    }
    try { htmlparser2 = require("htmlparser2"); } catch (err) { LOG.error(`Tika plugin unable to load htmlparser2. Will be using Tika for HTML parsing.`); }
    initialized = true;
}

exports.getContentStream = async function (inputstream, filepath, forcetika) {
    if (!initialized) try { await exports.initAsync(); } catch (err) {
        const error = `Unable to initialize the Tika plugin for text extraction. Error was ${err}`;
        LOG.error(error); throw(error);
    }

    if ((!forcetika) && filepath.toLowerCase().endsWith(".text") || filepath.toLowerCase().endsWith(".txt")) {
        LOG.info(`Tika.js using native text reader assuming UTF8 for the file ${filepath}.`);
        return inputstream;
    }
    if ((!forcetika) && htmlparser2 && (filepath.toLowerCase().endsWith(".html") || filepath.toLowerCase().endsWith(".htm"))) {
        LOG.info(`Tika.js using native html reader for the file ${filepath}.`);
        return await _getHTMLReadStream(inputstream);
    }

    LOG.info(`Tika.js using 3P Apache Tika libraries for the file ${filepath}.`);
    const extension = path.extname(filepath);
    if (!tikaconf.supported_types.includes(extension)) throw(`Unsupported file ${filepath}`);

    const _canAccessFile = async filepath => { try{
        await fspromises.access(filepath, fs.R_OK | fs.W_OK); return true;} catch (err) {return false;} };
    const _md5sum = text => crypto.createHash("md5").update(text).digest("hex");
    const basename = path.basename(filepath), stats = await _canAccessFile(filepath) ? await fspromises.stat(filepath) : {};
    const tempPrefix = _md5sum(filepath+"_"+stats.size+"_"+stats.mtimeMs);
    const finalReadPath = `${TIKA_TEMP_SUBDIR_READ}/${tempPrefix}_${basename}`;
    const finalWritePath = `${TIKA_TEMP_SUBDIR_WRITE}/${tempPrefix}_${basename}.txt`;
    const already_read = await _canAccessFile(finalReadPath), already_extracted = await _canAccessFile(finalWritePath);

    const workingareaReadPath = `${TIKA_TEMP_SUBDIR_READ}/${Date.now()}_${basename}`;
    const workingareaWritePath = `${TIKA_TEMP_SUBDIR_WRITE}/${Date.now()}_${basename}.txt`;
    if (!already_read) {await _copyFileToWorkingArea(inputstream, workingareaReadPath); 
        await fspromises.rename(workingareaReadPath, finalReadPath);}
    if (!already_extracted) {
        const outstream = fs.createWriteStream(workingareaWritePath);
        const tikaExecutor = _ => new Promise(async (resolve, reject) => {
            let resolved = false; 
            const tikaoptions = [...tikaconf.tikaoptions, `--config=${await _getTikaConfig(basename)}`];
            LOG.info(`Spawning Tika with ${tikaconf.java} ${tikaconf.javaoptions.join(" ")} -cp ${tikaconf.classpath.join(JAVA_CP_JOIN_CHAR)} ${tikaconf.tiakexec}  ${tikaoptions.join(" ")} ${finalReadPath}`);    
            try {
                const execed_process = spawn(`${tikaconf.java}`, [...tikaconf.javaoptions, "-cp", tikaconf.classpath.join(JAVA_CP_JOIN_CHAR), 
                    tikaconf.tiakexec, ...tikaoptions, finalReadPath]);
                execed_process.stdout.on("data", text => {
                    LOG.debug(`Tika plugin added ${text.length} bytes of parsed data from file ${filepath} to temporary file ${workingareaWritePath}.`);
                    outstream.write(text)
                });
                execed_process.on("close", _ => outstream.end());
                execed_process.stderr.on("error", error => {
                    LOG.error(`Tika error parsing file ${filepath} error is ${error}.`); outstream.end();
                    if (!resolved) {resolved = true; reject(error);}
                });
                outstream.on("finish", async _ => { if (!resolved) {
                    resolved = true; await fspromises.rename(workingareaWritePath, finalWritePath);
                    resolve(fs.createReadStream(finalWritePath)); } });
            } catch (err) {
                LOG.error(`Tika error parsing file ${filepath} error is ${err}.`); outstream.end();
                if (!resolved) {resolved = true; reject(err);}
            }
        });

        return ticketing.getTicket(tikaExecutor, true, `Tika plugin is in a wait to receive execution ticket for file ${filepath}.`);
    } else return fs.createReadStream(finalWritePath);
}

exports.getContent = async function(filepath, forcetika) {
    try {
        const readstreamExtractedText = await exports.getContentStream(fs.createReadStream(filepath), filepath, forcetika);
        return new Promise((resolve, reject) => {
            if (!readstreamExtractedText) reject("Failed on Tika stream creation.");
            const contents = [];
            readstreamExtractedText.on("data", chunk => contents.push(chunk));
            readstreamExtractedText.on("close", _ => resolve(Buffer.concat(contents)));
            readstreamExtractedText.on("error", err => reject(err));
        });
    } catch (err) {
        LOG.error(`Error extracting text due to ${err}`);
        throw err;
    }
}

function _copyFileToWorkingArea(inputstream, workingareaPath) {
    return new Promise((resolve, reject) => {
        const fileoutstreamTemp = fs.createWriteStream(workingareaPath);
        inputstream.on("error", err => reject(err));
        fileoutstreamTemp.on("error", err => reject(err));
        fileoutstreamTemp.on("close", _ => resolve());
        inputstream.pipe(fileoutstreamTemp);
    });
}

async function _getHTMLReadStream(inputstream) {
    const html = await neuranetutils.readFullFile(inputstream, "utf8");
    let text = "", skipText = false; const skippableTags = ["style", "script"];
    const htmlparser = new htmlparser2.Parser({
        ontext: data => {if (!skipText) text += data},
        onopentagname: name => skipText = skippableTags.includes(name.toLowerCase()),
        onclosetag: _ => skipText = false
    }, {decodeEntities: true});
    htmlparser.write(html); htmlparser.end();
    return stream.Readable.from([Buffer.from(text, "utf8")]);
}

async function _getTikaConfig(basenameOfFileToParse) {
    const ocrThisFile = tikaconf.always_ocr||basenameOfFileToParse.toLowerCase().indexOf(".ocr.") != -1;
    let filePreferredOCRLanguage; if (ocrThisFile) for (const key of Object.keys(tikaconf.ocrlanguage_bundles))
        if (basenameOfFileToParse.toLowerCase().indexOf(`.ocr.${key}.`) != -1) {
            filePreferredOCRLanguage = tikaconf.ocrlanguage_bundles[key]; break; }
    const ocrlanguages = ocrThisFile ? filePreferredOCRLanguage || Object.values(tikaconf.ocrlanguage_bundles).join("+") : undefined;
    const data = {max_content_length: tikaconf.max_content_length};
    if (ocrThisFile) data.ocr = {tesseract_path: tikaconf.tesseract_path, 
        tesseract_datapath: tikaconf.tesseract_datapath, ocrlanguages};

    const prefix = (ocrThisFile?"ocr":"noocr")+"_"+ocrlanguages||"noocrlang";
    const tmpFileName = `${TIKA_TEMP_SUBDIR_TEMP}/${prefix}_tikaconfig.xml`;
    let tikaXML = await fspromises.readFile(tikaconf.tika_config, "utf8"); 
    tikaXML = mustache.render(tikaXML, data);
    await fspromises.writeFile(tmpFileName, tikaXML, "utf8");
    return tmpFileName;
}
