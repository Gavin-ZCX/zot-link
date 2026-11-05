/* Unit tests for zot-link queue worker.
 * RED first: these tests should fail until src/queueWorker.js exists.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const __dirname = dirname(fileURLToPath(import.meta.url));

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

const writes = new Map();
const removed = [];
const children = [
  "C:/OneDrive/Zotero/_agent/queues/zot-link-actions/pending/001_attach_markdown.json",
  "C:/OneDrive/Zotero/_agent/queues/zot-link-actions/pending/002_main_update.json"
];
const files = new Map([
  [children[0], JSON.stringify({ action_id: "a1", action: "attach-markdown", parent_key: "PARENT42" })],
  [children[1], JSON.stringify({ action_id: "a2", action: "main-update-only", parent_key: "PARENT42", attachment_key: "ATTACH42" })]
]);

const parentItem = {
  key: "PARENT42",
  id: 42,
  isRegularItem: () => true,
  isAttachment: () => false
};
const attachmentItem = {
  key: "ATTACH42",
  isRegularItem: () => false,
  isAttachment: () => true,
  attachmentLinkMode: 2,
  attachmentPath: "attachments:_items/PARENT42/source/main.pdf",
  setField(field, value) { this[field] = value; },
  addTag(tag) { this.tag = tag; },
  async save() { this.saved = true; }
};

const sandbox = {
  Zotero: {
    debug() {},
    logError(e) { throw e; },
    Libraries: { userLibraryID: 1 },
    Items: {
      getByKey(key) {
        if (key === "PARENT42") return parentItem;
        if (key === "ATTACH42") return attachmentItem;
        return null;
      }
    },
    Prefs: {
      get(name) {
        if (name === "baseAttachmentPath") return "C:/OneDrive/Zotero";
        return null;
      }
    },
    Attachments: {
      LINK_MODE_LINKED_FILE: 2,
      async linkFromFile(opts) {
        return { key: "MDNEW42", opts, async save() {} };
      }
    }
  },
  IOUtils: {
    async exists() { return true; },
    async getChildren(path) {
      assert.equal(path, "C:/OneDrive/Zotero/_agent/queues/zot-link-actions/pending");
      return children;
    },
    async readUTF8(path) { return files.get(path); },
    async writeUTF8(path, content) { writes.set(path, JSON.parse(content)); },
    async remove(path) { removed.push(path); },
    async makeDirectory() {}
  },
  setInterval() { return 123; },
  clearInterval() {},
  console: { log() {} }
};

vm.createContext(sandbox);
for (const rel of ["../src/roles.js", "../src/paths.js", "../src/convert.js", "../src/queueWorker.js"]) {
  const src = readFileSync(join(__dirname, rel), "utf8");
  vm.runInContext(src, sandbox, { filename: rel });
}

const queueWorker = sandbox.Zotero.ZotLink && sandbox.Zotero.ZotLink.queueWorker;
assert.ok(queueWorker, "queueWorker namespace must exist");
assert.equal(typeof queueWorker.processPendingOnce, "function", "processPendingOnce must exist");
assert.equal(
  queueWorker.queueDirs("C:\\OneDrive\\Zotero").pending,
  "C:\\OneDrive\\Zotero\\_agent\\queues\\zot-link-actions\\pending",
  "Windows baseAttachmentPath must not produce mixed slash paths that IOUtils rejects"
);

const results = plain(await queueWorker.processPendingOnce({ zotero: sandbox.Zotero, ioUtils: sandbox.IOUtils }));
const status = plain(queueWorker.getStatus());
assert.equal(status.lastAssetRoot, "C:/OneDrive/Zotero");
assert.equal(status.lastPendingCount, 2);
assert.equal(status.lastQueueDirs.pending, "C:/OneDrive/Zotero/_agent/queues/zot-link-actions/pending");
assert.equal(results.length, 2);
assert.equal(results[0].status, "success");
assert.equal(results[0].action, "attach-markdown");
assert.equal(results[0].target_relative_path, "_items/PARENT42/md/paper.md");
assert.equal(results[0].new_attachment_key, "MDNEW42");
assert.equal(results[1].status, "success");
assert.equal(results[1].action, "main-update-only");
assert.equal(results[1].attachment_key, "ATTACH42");
assert.equal(attachmentItem.title, "Main PDF");
assert.equal(attachmentItem.tag, "role/main");
assert.equal(attachmentItem.saved, true);

assert.equal(writes.size, 2, "worker should write one result file per action");
assert.ok([...writes.keys()].every((p) => p.includes("/done/")), "successful actions must go to done");
assert.deepEqual(removed.sort(), children.sort(), "pending action files must be removed after result write");

console.log("queueWorker tests OK");
