/**
 * Handles extrainfo objects and AI app's associated with them - part of 
 * the bridge between Neuranet and XBin CMS.
 * 
 * (C) 2023 TekMonks. All rights reserved.
 * License: See the enclosed LICENSE file.
 */

const path = require("path");
const aiapp = require(`${NEURANET_CONSTANTS.LIBDIR}/aiapp.js`);
const cms = require(`${NEURANET_CONSTANTS.XBIN_CONSTANTS.LIB_DIR}/cms.js`);

/**
 * Register with cms to modify paths for Neuranet AI apps.
 */
exports.initSync = _ => {
    cms.addCMSPathModifier(async (cmsroot, id, org, extraInfo) => { // we remove user ID from the path
        const brainIDForUser = await aiapp.getAppID(id, org, extraInfo);

        if (extraInfo?.mode != NEURANET_CONSTANTS.AIAPPMODES.EDIT) {
            const modifiedRootWithNoUserID = path.resolve(cmsroot.replace(encodeURIComponent(id), ""));
            return `${modifiedRootWithNoUserID}/${brainIDForUser}`;
        } else return aiapp.getAppDir(id, org, brainIDForUser);
    });
}

/**
 * Returns metadata coded into extraInfo object
 * @param {object} extraInfo The extraInfo object.
 * @returns The metadata coded into extraInfo object or an empty object if none found.
 */
exports.getMetadata = extraInfo => extraInfo.metadata||{};

/**
 * Returns true if the AI app is being edited for this call
 * @param {object} extraInfo The extraInfo object.
 * @returns true if the AI app is being edited for this call
 */
exports.isAIAppBeingEdited = extraInfo => extraInfo.mode == NEURANET_CONSTANTS.AIAPPMODES.EDIT;

/**
 * Created an extraInfo object
 * @param {string} id The user ID
 * @param {string} org The org
 * @param {string} aiappid The AI app ID
 * @param {string} metadata The metadata associated with this call
 * @param {string} mode The mode
 * @returns The created extraInfo object
 */
exports.createExtraInfo = (id, org, aiappid, metadata, mode) => {return {id, org, metadata, aiappid, mode:
    mode == NEURANET_CONSTANTS.AIAPPMODES.EDIT ? mode : NEURANET_CONSTANTS.AIAPPMODES.TRAIN}};

/**
 * Unmarshalls an extraInfo object and returns, id, org, aiappid, metadata and modes associated with it
 * @param {object} extraInfo The extraInfo object
 * @returns id, org, aiappid, metadata and modes associated with it
 */
exports.unmarshallExtraInfo = extraInfo => extraInfo ? 
    {id: extraInfo.id, org: extraInfo.org, aiappid: extraInfo.aiappid, metadata: extraInfo.metadata, 
        mode: extraInfo.mode} : {};