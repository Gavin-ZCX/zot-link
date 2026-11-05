/* Focused test for the new remove-from-collection action in queueWorker.
 * Validates: member removal, idempotent not-a-member, item-not-found,
 * collection-not-found. Runs the action through executeAction via the sandbox.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const __dirname = dirname(fileURLToPath(import.meta.url));
function plain(v) { return JSON.parse(JSON.stringify(v)); }

// item ID 100 is a member of collection ID 7 (key COLL075). removeItems should drop it.
const removedFrom = [];
const itemA = {
  key: "ITEMAAAA", id: 100,
  isRegularItem: () => true, isAttachment: () => false,
  getCollections() { return this._cols || [7, 9]; },
  removeFromCollection(cid) { this._cols = (this._cols || [7, 9]).filter((c) => c !== cid); this._removedCid = cid; },
  async saveTx() { this._saved = true; },
};
itemA._cols = [7, 9];
const itemNotMember = {
  key: "ITEMBBBB", id: 200,
  isRegularItem: () => true, isAttachment: () => false,
  getCollections() { return [9]; }, // not in 7
  removeFromCollection() { throw new Error("should not be called for non-member"); },
  async saveTx() {},
};
const coll075 = {
  key: "COLL0750", id: 7,
  async removeItems(ids) { removedFrom.push(...ids); itemA._cols = [9]; },
};

const sandbox = {
  Zotero: {
    debug() {}, logError(e) { throw e; },
    Libraries: { userLibraryID: 1 },
    DB: { async executeTransaction(fn) { return await fn(); } },
    Items: {
      getByKey(key) {
        if (key === "ITEMAAAA") return itemA;
        if (key === "ITEMBBBB") return itemNotMember;
        return null;
      },
    },
    Collections: {
      getByLibraryAndKey(libID, key) {
        if (key === "COLL0750") return coll075;
        return null;
      },
    },
    Prefs: { get() { return "C:/OneDrive/Zotero"; } },
    Attachments: { LINK_MODE_LINKED_FILE: 2, async linkFromFile() { return {}; } },
  },
  IOUtils: {
    async exists() { return true; }, async getChildren() { return []; },
    async readUTF8() { return "{}"; }, async writeUTF8() {}, async remove() {}, async makeDirectory() {},
  },
  setInterval() { return 1; }, clearInterval() {}, console: { log() {} },
};

vm.createContext(sandbox);
for (const rel of ["../src/roles.js", "../src/paths.js", "../src/convert.js", "../src/queueWorker.js"]) {
  vm.runInContext(readFileSync(join(__dirname, rel), "utf8"), sandbox, { filename: rel });
}
const qw = sandbox.Zotero.ZotLink.queueWorker;
assert.equal(typeof qw.executeAction, "function", "executeAction must be exposed");

const deps = { zotero: sandbox.Zotero, ioUtils: sandbox.IOUtils };

// 1) happy path: remove member
let r = plain(await qw.executeAction({ action: "remove-from-collection", item_key: "ITEMAAAA", collection_key: "COLL0750" }, deps));
assert.equal(r.status, "success", "member removal should succeed: " + JSON.stringify(r));
assert.equal(r.reason, null);
assert.equal(itemA._removedCid, 7, "removeFromCollection must be called with collection id 7");
assert.equal(itemA._saved, true, "saveTx must be called");
assert.deepEqual(itemA.getCollections(), [9], "item should no longer be in collection 7");

// 2) idempotent: not a member -> success/not-a-member
r = plain(await qw.executeAction({ action: "remove-from-collection", item_key: "ITEMBBBB", collection_key: "COLL0750" }, deps));
assert.equal(r.status, "success", "not-a-member should be success");
assert.equal(r.reason, "not-a-member");

// 3) item not found
r = plain(await qw.executeAction({ action: "remove-from-collection", item_key: "NOPE0000", collection_key: "COLL0750" }, deps));
assert.equal(r.status, "blocked");
assert.equal(r.reason, "item-not-found");

// 4) collection not found
r = plain(await qw.executeAction({ action: "remove-from-collection", item_key: "ITEMAAAA", collection_key: "BADCOLLK" }, deps));
assert.equal(r.status, "blocked");
assert.equal(r.reason, "collection-not-found");

// 5) unknown action still fails (regression guard)
r = plain(await qw.executeAction({ action: "totally-unknown" }, deps));
assert.equal(r.status, "failed");
assert.equal(r.reason, "unknown-action");

console.log("remove-from-collection tests OK");
