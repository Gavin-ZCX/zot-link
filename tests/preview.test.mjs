/* Unit tests for zot-link preview dry-run helpers.
 * RED first: this test should fail until src/preview.js exists.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import assert from "node:assert/strict";

const __dirname = dirname(fileURLToPath(import.meta.url));
const sandbox = {
  Zotero: {
    debug() {},
    logError(e) { throw e; },
    Items: {
      get(id) {
        if (id === 42) return { key: "PARENT42" };
        return null;
      }
    },
    Prefs: {
      get(name) {
        if (name === "baseAttachmentPath") return "C:\\OneDrive\\Zotero";
        return null;
      }
    }
  }
};
vm.createContext(sandbox);

for (const rel of ["../src/roles.js", "../src/paths.js", "../src/preview.js"]) {
  const src = readFileSync(join(__dirname, rel), "utf8");
  vm.runInContext(src, sandbox, { filename: rel });
}

const preview = sandbox.Zotero.ZotLink.preview;
assert.ok(preview, "preview namespace must exist");

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function fakeAttachment({ parentID = 42, filename = "Original.pdf", path = "C:/Users/u/Zotero/storage/ABC/Original.pdf" } = {}) {
  return {
    key: "ATTACH01",
    parentID,
    attachmentFilename: filename,
    isAttachment: () => true,
    isRegularItem: () => false,
    isNote: () => false,
    getFilePath: () => path
  };
}

function fakeParent({ key = "PARENT99" } = {}) {
  return {
    key,
    isAttachment: () => false,
    isRegularItem: () => true,
    isNote: () => false
  };
}

assert.equal(preview.actionToRole("main"), "main");
assert.equal(preview.actionToRole("translation"), "translation");
assert.equal(preview.actionToRole("supplement"), "supplement");
assert.equal(preview.actionToRole("markdown"), "markdown");
assert.equal(preview.actionToRole("bogus"), null);
assert.equal(
  preview.absolutePathForRelativePath("_items/PARENT42/source/main.pdf", "C:\\OneDrive\\Zotero"),
  "C:\\OneDrive\\Zotero\\_items\\PARENT42\\source\\main.pdf"
);

const mainPreview = plain(preview.previewForSelection("main", {
  count: 1,
  hasAttachment: true,
  hasParent: false,
  hasNote: false,
  items: [fakeAttachment({ filename: "Paper.pdf" })]
}, sandbox.Zotero));
assert.deepEqual(mainPreview, {
  actionKey: "main",
  role: "main",
  status: "ready",
  reason: null,
  parentKey: "PARENT42",
  originalFilename: "Paper.pdf",
  currentPath: "C:/Users/u/Zotero/storage/ABC/Original.pdf",
  targetRelativePath: "_items/PARENT42/source/main.pdf",
  linkedAttachmentPath: "attachments:_items/PARENT42/source/main.pdf",
  targetFilename: "main.pdf",
  title: "Main PDF",
  tag: "role/main",
  supplementNumber: null,
  assetRoot: null,
  targetExists: null
});

const translationPreview = plain(preview.buildPreview({
  actionKey: "translation",
  parentKey: "PARENT42",
  originalFilename: "TR-论文.pdf",
  currentPath: "C:/tmp/TR-论文.pdf",
  isAttachment: true,
  isParent: false
}));
assert.equal(translationPreview.targetRelativePath, "_items/PARENT42/translations/TR-论文.pdf");
assert.equal(translationPreview.title, "Translation PDF - TR-论文.pdf");
assert.equal(translationPreview.tag, "role/translation");

const supplementPreview = plain(preview.buildPreview({
  actionKey: "supplement",
  parentKey: "PARENT42",
  originalFilename: "supp.pdf",
  isAttachment: true,
  existingRelativePaths: ["_items/PARENT42/source/supplement-01.pdf"]
}));
assert.equal(supplementPreview.targetRelativePath, "_items/PARENT42/source/supplement-02.pdf");
assert.equal(supplementPreview.title, "Supplement PDF - 02");
assert.equal(supplementPreview.supplementNumber, 2);

const markdownPreview = plain(preview.previewForSelection("markdown", {
  count: 1,
  hasAttachment: false,
  hasParent: true,
  hasNote: false,
  items: [fakeParent({ key: "PARENT99" })]
}, sandbox.Zotero));
assert.equal(markdownPreview.status, "ready");
assert.equal(markdownPreview.targetRelativePath, "_items/PARENT99/md/paper.md");
assert.equal(markdownPreview.title, "Markdown Full Text");
assert.equal(markdownPreview.tag, null);

const wrongScope = plain(preview.buildPreview({
  actionKey: "main",
  parentKey: "PARENT99",
  originalFilename: "x.pdf",
  isAttachment: false,
  isParent: true
}));
assert.equal(wrongScope.status, "blocked");
assert.equal(wrongScope.reason, "invalid-selection-for-action");

const mainConflict = plain(preview.buildPreview({
  actionKey: "main",
  parentKey: "PARENT42",
  originalFilename: "Paper.pdf",
  isAttachment: true,
  existingRelativePaths: ["_items/PARENT42/source/main.pdf"]
}));
assert.equal(mainConflict.status, "blocked");
assert.equal(mainConflict.reason, "main-target-exists");
assert.equal(mainConflict.targetRelativePath, "_items/PARENT42/source/main.pdf");

const msg = preview.formatPreviewMessage(mainPreview, {
  count: 1,
  hasAttachment: true,
  hasParent: false,
  hasNote: false
});
assert.ok(msg.includes("DRY-RUN ONLY"));
assert.ok(msg.includes("target      = _items/PARENT42/source/main.pdf"));
assert.ok(msg.includes("linked path = attachments:_items/PARENT42/source/main.pdf"));
assert.ok(msg.includes("title       = Main PDF"));
assert.ok(msg.includes("tag         = role/main"));
assert.ok(msg.includes("status      = ready"));

const fakeIOUtils = {
  async exists(path) {
    return path === "C:\\OneDrive\\Zotero\\_items\\PARENT42\\source\\main.pdf"
      || path === "C:\\OneDrive\\Zotero\\_items\\PARENT42\\source\\supplement-01.pdf"
      || path === "C:\\OneDrive\\Zotero\\_items\\PARENT42\\source\\supplement-02.pdf";
  }
};

const preflightMain = plain(await preview.previewForSelectionWithPreflight("main", {
  count: 1,
  hasAttachment: true,
  hasParent: false,
  hasNote: false,
  items: [fakeAttachment({ filename: "Paper.pdf" })]
}, sandbox.Zotero, fakeIOUtils));
assert.equal(preflightMain.status, "blocked");
assert.equal(preflightMain.reason, "main-target-exists");
assert.equal(preflightMain.assetRoot, "C:\\OneDrive\\Zotero");
assert.equal(preflightMain.targetExists, true);

const preflightSupplement = plain(await preview.previewForSelectionWithPreflight("supplement", {
  count: 1,
  hasAttachment: true,
  hasParent: false,
  hasNote: false,
  items: [fakeAttachment({ filename: "Supp.pdf" })]
}, sandbox.Zotero, fakeIOUtils));
assert.equal(preflightSupplement.status, "ready");
assert.equal(preflightSupplement.targetRelativePath, "_items/PARENT42/source/supplement-03.pdf");
assert.equal(preflightSupplement.targetExists, false);

console.log("preview tests OK");
