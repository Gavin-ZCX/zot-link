/* Lightweight tests for src/contextMenu.js.
 * Runs the file in a Node vm sandbox with a stub Zotero global, then asserts
 * the pure-function surface (labels, ids, dry-run message, visibility) plus
 * a minimal DOM helper (findItemPopup) and selection extractor.
 *
 * No external dependencies; invoked by `npm run check`.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import assert from "node:assert/strict";

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, "..", "src", "contextMenu.js"), "utf8");

const debugLog = [];
const errorLog = [];
const sandbox = {
  Zotero: {
    debug: (m) => debugLog.push(String(m)),
    logError: (e) => errorLog.push(e)
  }
};
vm.createContext(sandbox);
vm.runInContext(src, sandbox, { filename: "contextMenu.js" });

const cm = sandbox.Zotero.ZotLink && sandbox.Zotero.ZotLink.contextMenu;
assert.ok(cm, "contextMenu namespace must be exposed under Zotero.ZotLink");

// --- Action labels ---------------------------------------------------------
assert.equal(cm.actionLabel("main"),        "zot-link: 整理为 Main PDF");
assert.equal(cm.actionLabel("translation"), "zot-link: 整理为 Translation PDF");
assert.equal(cm.actionLabel("supplement"),  "zot-link: 整理为 Supplement PDF");
assert.equal(cm.actionLabel("markdown"),    "zot-link: 挂接 Markdown Full Text");
assert.equal(cm.actionLabel("bogus"), null);

// --- Menu IDs unique & disjoint from separator ----------------------------
const ids = cm.ACTIONS.map((a) => cm.menuItemId(a.key));
assert.equal(new Set(ids).size, ids.length, "menu item IDs must be unique");
assert.ok(!ids.includes(cm.SEPARATOR_ID), "separator id must not collide with any menuitem id");
assert.ok(cm.SEPARATOR_ID.startsWith("zot-link"), "ids must be namespaced");
for (const id of ids) {
  assert.ok(id.startsWith(cm.ITEM_ID_PREFIX), "menu item id must use the documented prefix");
}

// --- Dry-run message --------------------------------------------------------
const sel = { count: 2, hasAttachment: true, hasParent: false, hasNote: false };
const msg = cm.dryRunMessage("main", sel);
assert.ok(msg.includes("Main PDF"),     "dry-run message includes the action label");
assert.ok(msg.includes("DRY-RUN"),      "dry-run message advertises DRY-RUN");
assert.ok(msg.includes("count       = 2"),     "dry-run message includes selection count");
assert.ok(msg.includes("attachment? = true"),  "dry-run message includes attachment flag");
assert.ok(msg.includes("parent?     = false"), "dry-run message includes parent flag");
// Unknown action key still yields a non-empty message (fail-safe).
const msgUnknown = cm.dryRunMessage("unknown-key", {});
assert.ok(msgUnknown.includes("unknown-key"));
assert.ok(msgUnknown.includes("DRY-RUN"));

// --- Visibility logic ------------------------------------------------------
const att = { hasAttachment: true,  hasParent: false };
const par = { hasAttachment: false, hasParent: true  };
const mix = { hasAttachment: true,  hasParent: true  };
assert.equal(cm.computeVisibility({ scope: "attachment" }, att), true);
assert.equal(cm.computeVisibility({ scope: "attachment" }, par), false);
assert.equal(cm.computeVisibility({ scope: "parent" },     par), true);
assert.equal(cm.computeVisibility({ scope: "parent" },     att), false);
assert.equal(cm.computeVisibility({ scope: "attachment" }, mix), true);
assert.equal(cm.computeVisibility({ scope: "parent" },     mix), true);
assert.equal(cm.computeVisibility({ scope: "any" },        att), true);

// --- findItemPopup ---------------------------------------------------------
const docOK = {
  _byId: { "zotero-itemmenu": { id: "zotero-itemmenu" } },
  getElementById(id) { return this._byId[id] || null; }
};
const foundOK = cm.findItemPopup(docOK);
assert.ok(foundOK, "popup should be found when zotero-itemmenu exists");
assert.equal(foundOK.id, "zotero-itemmenu");
assert.equal(foundOK.el.id, "zotero-itemmenu");

const docEmpty = { getElementById() { return null; } };
assert.equal(cm.findItemPopup(docEmpty), null, "popup absent → null");
assert.equal(cm.findItemPopup(null),     null, "null doc → null");

// --- getSelectionInfo ------------------------------------------------------
function fakeItem({ attachment = false, note = false, regular = false } = {}) {
  return {
    isAttachment:  () => attachment,
    isNote:        () => note,
    isRegularItem: () => regular
  };
}
const winNoPane = {};
const infoEmpty = cm.getSelectionInfo(winNoPane);
assert.equal(infoEmpty.count, 0);
assert.equal(infoEmpty.hasAttachment, false);
assert.equal(infoEmpty.hasParent, false);

const winAtt = {
  ZoteroPane: {
    getSelectedItems: () => [fakeItem({ attachment: true })]
  }
};
const infoAtt = cm.getSelectionInfo(winAtt);
assert.equal(infoAtt.count, 1);
assert.equal(infoAtt.hasAttachment, true);
assert.equal(infoAtt.hasParent, false);

const winPar = {
  ZoteroPane: {
    getSelectedItems: () => [fakeItem({ regular: true }), fakeItem({ regular: true })]
  }
};
const infoPar = cm.getSelectionInfo(winPar);
assert.equal(infoPar.count, 2);
assert.equal(infoPar.hasParent, true);
assert.equal(infoPar.hasAttachment, false);

const winMix = {
  ZoteroPane: {
    getSelectedItems: () => [
      fakeItem({ regular: true }),
      fakeItem({ attachment: true }),
      fakeItem({ note: true })
    ]
  }
};
const infoMix = cm.getSelectionInfo(winMix);
assert.equal(infoMix.count, 3);
assert.equal(infoMix.hasAttachment, true);
assert.equal(infoMix.hasParent, true);
assert.equal(infoMix.hasNote, true);

// Throwing getSelectedItems must not crash the helper.
const winThrow = {
  ZoteroPane: {
    getSelectedItems: () => { throw new Error("boom"); }
  }
};
const infoThrow = cm.getSelectionInfo(winThrow);
assert.equal(infoThrow.count, 0);

console.log("contextMenu tests OK");
