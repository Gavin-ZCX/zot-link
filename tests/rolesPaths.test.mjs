/* Unit tests for zot-link role/title/path pure functions.
 * RED first: these tests should fail until src/roles.js and src/paths.js exist.
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
    logError(e) { throw e; }
  }
};
vm.createContext(sandbox);

for (const rel of ["../src/roles.js", "../src/paths.js"]) {
  const src = readFileSync(join(__dirname, rel), "utf8");
  vm.runInContext(src, sandbox, { filename: rel });
}

const roles = sandbox.Zotero.ZotLink.roles;
const paths = sandbox.Zotero.ZotLink.paths;
assert.ok(roles, "roles namespace must exist");
assert.ok(paths, "paths namespace must exist");

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

// --- roles: labels, tags, titles ------------------------------------------
assert.equal(roles.normalizeRole("main"), "main");
assert.equal(roles.normalizeRole("role/main"), "main");
assert.equal(roles.normalizeRole("translation"), "translation");
assert.equal(roles.normalizeRole("supplement"), "supplement");
assert.equal(roles.normalizeRole("markdown"), "markdown");
assert.equal(roles.normalizeRole("unknown"), null);

assert.equal(roles.roleTagForRole("main"), "role/main");
assert.equal(roles.roleTagForRole("translation"), "role/translation");
assert.equal(roles.roleTagForRole("supplement"), "role/supplement");
assert.equal(roles.roleTagForRole("markdown"), null);

assert.equal(roles.attachmentTitleForRole("main", "Original.pdf"), "Main PDF");
assert.equal(roles.attachmentTitleForRole("translation", "TR-论文.pdf"), "Translation PDF - TR-论文.pdf");
assert.equal(roles.attachmentTitleForRole("supplement", "data.pdf", { supplementNumber: 3 }), "Supplement PDF - 03");
assert.equal(roles.attachmentTitleForRole("markdown", "paper.md"), "Markdown Full Text");

// --- roles: explicit/tag/default resolution --------------------------------
assert.deepEqual(
  plain(roles.resolveRole({ explicitRole: "translation", tags: ["role/main"], mode: "manual" })),
  { status: "ready", role: "translation", source: "explicit", reason: null }
);
assert.deepEqual(
  plain(roles.resolveRole({ tags: ["todo", "role/supplement"], mode: "batch" })),
  { status: "ready", role: "supplement", source: "tag", reason: null }
);
assert.deepEqual(
  plain(roles.resolveRole({ tags: [], mode: "manual" })),
  { status: "ready", role: "main", source: "manual-default", reason: null }
);
assert.deepEqual(
  plain(roles.resolveRole({ tags: [], mode: "batch" })),
  { status: "blocked", role: null, source: null, reason: "missing-role-in-batch" }
);
assert.deepEqual(
  plain(roles.resolveRole({ tags: ["role/main", "role/translation"], mode: "batch" })),
  { status: "blocked", role: null, source: "tag", reason: "conflicting-role-tags" }
);

// --- paths: fixed target paths ---------------------------------------------
assert.equal(paths.itemRoot("ABCD1234"), "_items/ABCD1234");
assert.equal(paths.sourceDir("ABCD1234"), "_items/ABCD1234/source");
assert.equal(paths.translationsDir("ABCD1234"), "_items/ABCD1234/translations");
assert.equal(paths.mdDir("ABCD1234"), "_items/ABCD1234/md");

assert.deepEqual(
  plain(paths.targetPathForRole({ parentKey: "ABCD1234", role: "main", originalFilename: "foo.pdf" })),
  { status: "ready", role: "main", relativePath: "_items/ABCD1234/source/main.pdf", filename: "main.pdf", reason: null }
);
assert.deepEqual(
  plain(paths.targetPathForRole({ parentKey: "ABCD1234", role: "translation", originalFilename: "TR-论文.pdf" })),
  { status: "ready", role: "translation", relativePath: "_items/ABCD1234/translations/TR-论文.pdf", filename: "TR-论文.pdf", reason: null }
);
assert.deepEqual(
  plain(paths.targetPathForRole({ parentKey: "ABCD1234", role: "markdown", originalFilename: "ignored.md" })),
  { status: "ready", role: "markdown", relativePath: "_items/ABCD1234/md/paper.md", filename: "paper.md", reason: null }
);

// main.pdf conflict must not overwrite.
assert.deepEqual(
  plain(paths.targetPathForRole({
    parentKey: "ABCD1234",
    role: "main",
    originalFilename: "foo.pdf",
    existingRelativePaths: ["_items/ABCD1234/source/main.pdf"]
  })),
  { status: "blocked", role: "main", relativePath: "_items/ABCD1234/source/main.pdf", filename: "main.pdf", reason: "main-target-exists" }
);

// supplement number increments and ignores unrelated filenames.
assert.equal(
  paths.nextSupplementNumber({
    parentKey: "ABCD1234",
    existingRelativePaths: [
      "_items/ABCD1234/source/main.pdf",
      "_items/ABCD1234/source/supplement-01.pdf",
      "_items/ABCD1234/source/supplement-03.pdf",
      "_items/ZZZZ9999/source/supplement-99.pdf"
    ]
  }),
  4
);
assert.deepEqual(
  plain(paths.targetPathForRole({
    parentKey: "ABCD1234",
    role: "supplement",
    originalFilename: "whatever.pdf",
    existingRelativePaths: ["_items/ABCD1234/source/supplement-01.pdf"]
  })),
  { status: "ready", role: "supplement", relativePath: "_items/ABCD1234/source/supplement-02.pdf", filename: "supplement-02.pdf", reason: null, supplementNumber: 2 }
);

// Windows absolute path under asset root becomes Zotero linked attachment relative path.
assert.equal(
  paths.relativeAttachmentPath("C:\\OneDrive\\Zotero\\_items\\ABCD1234\\source\\main.pdf", "C:\\OneDrive\\Zotero"),
  "attachments:_items/ABCD1234/source/main.pdf"
);

// Path traversal in source filename is stripped for translation preservation.
assert.equal(paths.basename("C:\\tmp\\TR-file.pdf"), "TR-file.pdf");
assert.equal(paths.basename("../evil.pdf"), "evil.pdf");

console.log("rolesPaths tests OK");
