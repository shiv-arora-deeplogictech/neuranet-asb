/**
 * Init and run the app. 
 * (C) 2024 TekMonks. All rights reserved.
 * See enclosed LICENSE file.
 */

_init();
async function _init() {
    /*const {webbundlesupport} = await import("/framework/js/webbundlesupport.mjs");    // use monkshu web bundles
    if (!await webbundlesupport.addWebbundleSupport()) 
        console.error("Webbundle loading failed or not available. Website performance will be slow.")*/

    await import("/framework/js/$$.js"); 
    $$.boot(); // now boot the app
}
