/* zot-link bootstrap (Zotero 7 / 9 lifecycle) */
/* eslint-disable no-unused-vars */

var ZotLink;
var chromeHandle;
var { Services } = ChromeUtils.importESModule("resource://gre/modules/Services.sys.mjs");

function log(msg) {
  if (typeof Zotero !== "undefined" && Zotero.debug) {
    Zotero.debug("[zot-link] " + msg);
  }
}

async function waitForZotero() {
  if (typeof Zotero !== "undefined" && Zotero.initializationPromise) {
    await Zotero.initializationPromise;
    return;
  }

  await new Promise((resolve) => {
    const observer = {
      observe() {
        Services.obs.removeObserver(observer, "zotero-loaded");
        resolve();
      }
    };
    Services.obs.addObserver(observer, "zotero-loaded");
  });
  await Zotero.initializationPromise;
}

async function install(data, reason) {
  log("install reason=" + reason);
}

async function startup({ id, version, rootURI }, reason) {
  log("startup version=" + version + " reason=" + reason);
  await waitForZotero();

  Services.scriptloader.loadSubScript(rootURI + "src/roles.js");
  Services.scriptloader.loadSubScript(rootURI + "src/paths.js");
  Services.scriptloader.loadSubScript(rootURI + "src/preview.js");
  Services.scriptloader.loadSubScript(rootURI + "src/convert.js");
  Services.scriptloader.loadSubScript(rootURI + "src/autoConvert.js");
  Services.scriptloader.loadSubScript(rootURI + "src/menus.js");
  Services.scriptloader.loadSubScript(rootURI + "src/contextMenu.js");

  ZotLink = Zotero.ZotLink;
  if (!ZotLink) {
    Zotero.logError(new Error("[zot-link] menus.js did not expose Zotero.ZotLink"));
    return;
  }

  ZotLink.init({ id, version, rootURI });

  // Hook every open main Zotero window.
  const enumerator = Services.wm.getEnumerator("navigator:browser");
  while (enumerator.hasMoreElements()) {
    ZotLink.addToWindow(enumerator.getNext());
  }

  // Listen for future windows.
  Services.wm.addListener(ZotLink.windowListener);

  // Start tag-triggered auto-conversion.
  if (ZotLink.autoConvert && typeof ZotLink.autoConvert.start === "function") {
    ZotLink.autoConvert.start();
  }
}

async function shutdown({ id, version, rootURI }, reason) {
  log("shutdown reason=" + reason);
  if (!ZotLink) return;

  if (ZotLink.autoConvert && typeof ZotLink.autoConvert.stop === "function") {
    ZotLink.autoConvert.stop();
  }

  Services.wm.removeListener(ZotLink.windowListener);
  const enumerator = Services.wm.getEnumerator("navigator:browser");
  while (enumerator.hasMoreElements()) {
    ZotLink.removeFromWindow(enumerator.getNext());
  }
  ZotLink.uninit();
  ZotLink = undefined;
}

async function uninstall(data, reason) {
  log("uninstall reason=" + reason);
}
