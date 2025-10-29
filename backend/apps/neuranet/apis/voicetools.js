/**
 * Voice tools API for TTS and STT.
 * 
 * (C) 2025 TekMonks. All rights reserved.
 */

const fs = require("fs");
const path = require("path");
const child_process = require("child_process");

const SHELL_WRAPPER = path.join(NEURANET_CONSTANTS.THIRDPARTYDIR, "python.sh");
const STT_SCRIPT = `${NEURANET_CONSTANTS.THIRDPARTYDIR}/stt.py`;
const TTS_SCRIPT = `${NEURANET_CONSTANTS.THIRDPARTYDIR}/tts.py`;

exports.REASONS = { VALIDATION: "Validation failed", EXECUTION: "Execution failed" };

exports.doService = async (jsonReq) => {
    if (!validateRequest(jsonReq)) {
        LOG.error(`Voice service validation failed. Incoming request was: ${JSON.stringify(jsonReq)}`);
        return { result: false, reason: exports.REASONS.VALIDATION };
    }

    LOG.info(`Voice Service Request: ${JSON.stringify(jsonReq)}`);

    try {
        let result;
        if (jsonReq.service === "stt") {
            result = await runPythonViaShell(STT_SCRIPT, { audiofile: jsonReq.audiofile });
            LOG.info(`Voice Service Python Result: ${JSON.stringify(result)}`);
            return result;
        } else if (jsonReq.service === "tts") {
            result = await runPythonViaShell(TTS_SCRIPT, { text: jsonReq.text });
            LOG.info(`Voice Service Python Result: ${JSON.stringify(result)}`);
            return result;
        } else {
            return { result: false, reason: "Unknown service type" };
        }


    } catch (err) {
        LOG.error(`Voice service execution error: ${err}`);
        return { result: false, reason: exports.REASONS.EXECUTION };
    }
};

const validateRequest = (jsonReq) => {
    if (!jsonReq || !jsonReq.service) return false;
    if (jsonReq.service === "stt" && !jsonReq.audiofile) return false;
    if (jsonReq.service === "tts" && !jsonReq.text) return false;
    return true;
};


function runPythonViaShell(pythonScript, payload) {
    return new Promise((resolve, reject) => {
        if (!fs.existsSync(SHELL_WRAPPER)) {
            return reject(`Missing python.sh at ${SHELL_WRAPPER}`);
        }

        let args;
        let tempFile;

        // STT requires a file because the JSON is large
        if (pythonScript.includes("stt.py")) {
            tempFile = path.join("/tmp", `stt_${Date.now()}.json`);
            fs.writeFileSync(tempFile, JSON.stringify(payload));
            args = [pythonScript, tempFile];   // pass file path
        } else {
            args = [pythonScript, JSON.stringify(payload)];
        }

        child_process.execFile(SHELL_WRAPPER, args, { encoding: "utf-8", maxBuffer: 50 * 1024 * 1024 }, (err, stdout, stderr) => {
            if (err) {
                LOG.error(`Shell execution failed: ${stderr}`);
                return reject(stderr || err.message);
            }
            try {
                const parsed = JSON.parse(stdout.trim());
                resolve(parsed);
            } catch (e) {
                reject(`Failed to parse Python output: ${stdout}`);
            }
        });
    });
}
