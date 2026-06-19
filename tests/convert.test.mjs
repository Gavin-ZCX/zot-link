/* Unit tests for zot-link convert (attachment → linked).
 * RED first: these tests should fail until src/convert.js exists.
 */

import { readFileSync, mkdirSync, writeFileSync, rmSync, existsSync, statSync, readdirSync } from "node:fs";
import { dirname, join, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import vm from "node:vm";
import assert from "node:assert/strict";

const __dirname = dirname(fileURLToPath(import.meta.url));
const tmpDir = join(__dirname, ".tmp-convert-test");
rmSync(tmpDir, { recursive: true, force: true });
mkdirSync(tmpDir, { recursive: true });

// Create a test file
const testFilePath = join(tmpDir, "storage", "ABC", "Paper.pdf");
mkdirSync(dirname(testFilePath), { recursive: true });
writeFileSync(testFilePath, "FAKE PDF CONTENT " + "x".repeat(100));

const targetRoot = join(tmpDir, "target");
mkdirSync(targetRoot, { recursive: true });

// --- Zotero mock ---
let nextItemID = 1000;
const createdItems = [];
const erasedItems = [];
const transferredChildItems = [];
const transferredRelations = [];
const transferredFulltext = [];
const savedItems = [];
let cloneSource = null;

function resetMocks() {
  nextItemID = 1000;
  createdItems.length = 0;
  erasedItems.length = 0;
  transferredChildItems.length = 0;
  transferredRelations.length = 0;
  transferredFulltext.length = 0;
  savedItems.length = 0;
  cloneSource = null;
}

const sandbox = {
  Zotero: {
    debug() {},
    logError(e) { throw e; },
    nextItemID: 0,
    Items: {
      get(id) {
        if (id === 42) return {
          key: "PARENT42",
          isRegularItem: () => true,
          isAttachment: () => false,
          isNote: () => false
        };
        return null;
      },
      moveChildItems(src, dst) {
        transferredChildItems.push({ from: src.key, to: dst.key });
      }
    },
    Relations: {
      copyObjectSubjectRelations(src, dst) {
        transferredRelations.push({ from: src.key, to: dst.key });
      }
    },
    Fulltext: {
      transferItemIndex(src, dst) {
        transferredFulltext.push({ from: src.key, to: dst.key });
      }
    },
    Attachments: {
      LINK_MODE_IMPORTED_FILE: 0,
      LINK_MODE_LINKED_FILE: 2,
      LINK_MODE_LINKED_URL: 3
    },
    Prefs: {
      get(name) {
        if (name === "baseAttachmentPath") return targetRoot;
        if (name === "saveRelativeAttachmentPath") return true;
        return null;
      }
    },
    File: {
      pathToFile(p) { return p; },
      getFileHash(p) { return createHash("sha256").update(readFileSync(p)).digest("hex"); }
    }
  },
  IOUtils: {
    async copy(src, dst) {
      mkdirSync(dirname(dst), { recursive: true });
      writeFileSync(dst, readFileSync(src));
      return statSync(dst).size;
    },
    async remove(path) {
      rmSync(path);
    },
    async exists(path) {
      return existsSync(path);
    }
  },
  console: { log() {} }
};

// Add convert module sources
vm.createContext(sandbox);
for (const rel of ["../src/roles.js", "../src/paths.js", "../src/preview.js", "../src/convert.js"]) {
  const src = readFileSync(join(__dirname, rel), "utf8");
  vm.runInContext(src, sandbox, { filename: rel });
}

const convert = sandbox.Zotero.ZotLink && sandbox.Zotero.ZotLink.convert;
assert.ok(convert, "convert namespace must exist");
assert.equal(typeof convert.convertImportedToLinked, "function", "convertImportedToLinked must exist");

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

// --- Test: successful main.pdf conversion --------------------------------
resetMocks();
const testSourceFile = join(tmpDir, "storage", "ABC", "Paper.pdf");
const targetDir = join(targetRoot, "_items", "PARENT42", "source");
const expectedTarget = join(targetDir, "main.pdf");

const sourceItem = {
  key: "ATTACH01",
  parentID: 42,
  parentKey: "PARENT42",
  isAttachment: () => true,
  isRegularItem: () => false,
  isNote: () => false,
  getFilePath: () => testSourceFile,
  attachmentFilename: "Paper.pdf",
  attachmentLinkMode: 0, // imported_file
  clone: function() {
    cloneSource = this;
    const cloned = {
      key: "CLONE" + (++nextItemID),
      attachmentPath: null,
      attachmentLinkMode: null,
      async save() {
        savedItems.push({ key: this.key, path: this.attachmentPath, mode: this.attachmentLinkMode });
        createdItems.push(this);
      }
    };
    return cloned;
  },
  async erase() {
    erasedItems.push(this);
  },
  getField(f) {
    if (f === "title") return "Paper.pdf";
    return null;
  }
};

const result = plain(await convert.convertImportedToLinked({
  item: sourceItem,
  actionKey: "main",
  parentKey: "PARENT42",
  targetRelativePath: "_items/PARENT42/source/main.pdf",
  title: "Main PDF",
  tag: "role/main",
  zotero: sandbox.Zotero,
  ioUtils: sandbox.IOUtils
}));

assert.equal(result.status, "success", `Expected success but got ${result.status}: ${result.reason}`);
assert.equal(result.parentKey, "PARENT42");
assert.ok(existsSync(expectedTarget), "Target file must exist on disk");
assert.equal(readFileSync(expectedTarget, "utf8"), readFileSync(testSourceFile, "utf8"), "Copy must be byte-identical");
assert.equal(erasedItems.length, 1, "Original must be erased");
assert.equal(erasedItems[0].key, "ATTACH01");
assert.equal(savedItems.length, 1, "Cloned linked attachment must be saved");
assert.equal(savedItems[0].mode, 2, "Clone must be LINK_MODE_LINKED_FILE");
assert.equal(transferredChildItems.length, 1, "Child items must be transferred");
assert.equal(transferredRelations.length, 1, "Relations must be transferred");
assert.equal(transferredFulltext.length, 1, "Fulltext index must be transferred");

// --- Test: target exists → blocked, no damage ----------------------------
resetMocks();
// Clean up and recreate the source file
rmSync(testSourceFile, { force: true });
mkdirSync(dirname(testSourceFile), { recursive: true });
writeFileSync(testSourceFile, "PAPER2 " + "y".repeat(100));
// Create the conflict
mkdirSync(dirname(expectedTarget), { recursive: true });
writeFileSync(expectedTarget, "EXISTING MAIN PDF");

const blockedResult = plain(await convert.convertImportedToLinked({
  item: { ...sourceItem, key: "ATTACH02" },
  actionKey: "main",
  parentKey: "PARENT42",
  targetRelativePath: "_items/PARENT42/source/main.pdf",
  title: "Main PDF",
  tag: "role/main",
  targetExists: true,
  zotero: sandbox.Zotero,
  ioUtils: sandbox.IOUtils
}));

assert.equal(blockedResult.status, "blocked");
assert.equal(blockedResult.reason, "target-exists");
assert.equal(erasedItems.length, 0, "Must not erase on conflict");
assert.equal(savedItems.length, 0, "Must not save on conflict");
assert.equal(readFileSync(expectedTarget, "utf8"), "EXISTING MAIN PDF", "Existing file must not be overwritten");

// --- Test: copy fails → original preserved --------------------------------
resetMocks();
rmSync(expectedTarget, { force: true });
const badIOUtils = {
  async copy() { throw new Error("disk full"); },
  async remove() {},
  async exists(p) { return existsSync(p); }
};

const failResult = plain(await convert.convertImportedToLinked({
  item: { ...sourceItem, key: "ATTACH03" },
  actionKey: "main",
  parentKey: "PARENT42",
  targetRelativePath: "_items/PARENT42/source/main.pdf",
  title: "Main PDF",
  tag: "role/main",
  zotero: sandbox.Zotero,
  ioUtils: badIOUtils
}));

assert.equal(failResult.status, "failed");
assert.ok(failResult.reason.includes("copy"), `Expected copy-related reason, got: ${failResult.reason}`);
assert.equal(erasedItems.length, 0, "Original must not be erased on copy failure");
assert.equal(existsSync(testSourceFile), true, "Source file must still exist");

// --- Test: clone fails → original preserved, target cleaned --------------
resetMocks();
rmSync(expectedTarget, { force: true });
mkdirSync(dirname(testSourceFile), { recursive: true });
writeFileSync(testSourceFile, "VALID " + "z".repeat(100));

const badCloneItem = {
  ...sourceItem,
  key: "ATTACH04",
  clone() { throw new Error("clone failed"); }
};

const cloneFailResult = plain(await convert.convertImportedToLinked({
  item: badCloneItem,
  actionKey: "main",
  parentKey: "PARENT42",
  targetRelativePath: "_items/PARENT42/source/main.pdf",
  title: "Main PDF",
  tag: "role/main",
  zotero: sandbox.Zotero,
  ioUtils: sandbox.IOUtils
}));

assert.equal(cloneFailResult.status, "failed");
assert.ok(cloneFailResult.reason.includes("clone"), `Expected clone-related reason, got: ${cloneFailResult.reason}`);
assert.equal(erasedItems.length, 0, "Original must not be erased on clone failure");

// Cleanup
rmSync(tmpDir, { recursive: true, force: true });

console.log("convert tests OK");
