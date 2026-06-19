/* zot-link paths — pure target-path helpers for _items/{KEY} layout.
 *
 * No file I/O. Callers provide existingRelativePaths when conflict/numbering
 * decisions need disk knowledge. Exposes Zotero.ZotLink.paths.
 */

(function () {
  "use strict";

  const ITEM_ROOT = "_items";

  function toForwardSlashes(path) {
    return String(path || "").replace(/\\+/g, "/");
  }

  function trimSlashes(path) {
    return toForwardSlashes(path).replace(/^\/+|\/+$/g, "");
  }

  function basename(path) {
    const normalized = toForwardSlashes(path);
    const parts = normalized.split("/").filter(Boolean);
    return parts.length ? parts[parts.length - 1] : "";
  }

  function normalizeParentKey(parentKey) {
    if (parentKey == null) return "";
    return String(parentKey).trim();
  }

  function itemRoot(parentKey) {
    return ITEM_ROOT + "/" + normalizeParentKey(parentKey);
  }

  function sourceDir(parentKey) {
    return itemRoot(parentKey) + "/source";
  }

  function translationsDir(parentKey) {
    return itemRoot(parentKey) + "/translations";
  }

  function mdDir(parentKey) {
    return itemRoot(parentKey) + "/md";
  }

  function hasExisting(existingRelativePaths, relativePath) {
    const target = trimSlashes(relativePath).toLowerCase();
    return (existingRelativePaths || []).some((p) => trimSlashes(p).toLowerCase() === target);
  }

  function nextSupplementNumber(input) {
    const opts = input || {};
    const dir = sourceDir(opts.parentKey).toLowerCase() + "/";
    let max = 0;
    for (const p of opts.existingRelativePaths || []) {
      const rel = trimSlashes(p).toLowerCase();
      if (!rel.startsWith(dir)) continue;
      const name = rel.slice(dir.length);
      const m = /^supplement-(\d{2,})\.pdf$/.exec(name);
      if (m) max = Math.max(max, Number(m[1]));
    }
    return max + 1;
  }

  function pad2(n) {
    return String(n).padStart(2, "0");
  }

  function supplementFilename(number) {
    return "supplement-" + pad2(number) + ".pdf";
  }

  function ready(role, relativePath, filename, extra) {
    return Object.assign({ status: "ready", role, relativePath, filename, reason: null }, extra || {});
  }

  function blocked(role, relativePath, filename, reason, extra) {
    return Object.assign({ status: "blocked", role, relativePath, filename, reason }, extra || {});
  }

  function targetPathForRole(input) {
    const opts = input || {};
    const roles = Zotero.ZotLink && Zotero.ZotLink.roles;
    const role = roles && roles.normalizeRole ? roles.normalizeRole(opts.role) : String(opts.role || "").trim();
    const parentKey = normalizeParentKey(opts.parentKey);

    if (!parentKey) {
      return blocked(role || null, null, null, "missing-parent-key");
    }

    if (role === "main") {
      const filename = "main.pdf";
      const relativePath = sourceDir(parentKey) + "/" + filename;
      if (hasExisting(opts.existingRelativePaths, relativePath)) {
        return blocked(role, relativePath, filename, "target-exists");
      }
      return ready(role, relativePath, filename);
    }

    if (role === "translation") {
      const filename = basename(opts.originalFilename) || "translation.pdf";
      const relativePath = translationsDir(parentKey) + "/" + filename;
      return ready(role, relativePath, filename);
    }

    if (role === "supplement") {
      const supplementNumber = nextSupplementNumber({
        parentKey,
        existingRelativePaths: opts.existingRelativePaths || []
      });
      const filename = supplementFilename(supplementNumber);
      const relativePath = sourceDir(parentKey) + "/" + filename;
      return ready(role, relativePath, filename, { supplementNumber });
    }

    if (role === "markdown") {
      const filename = "paper.md";
      const relativePath = mdDir(parentKey) + "/" + filename;
      return ready(role, relativePath, filename);
    }

    return blocked(role || null, null, null, "unknown-role");
  }

  function relativeAttachmentPath(absPath, assetRoot) {
    const abs = toForwardSlashes(absPath);
    const root = toForwardSlashes(assetRoot).replace(/\/+$/g, "");
    let rel = abs;
    if (root && abs.toLowerCase().startsWith(root.toLowerCase() + "/")) {
      rel = abs.slice(root.length + 1);
    }
    return "attachments:" + trimSlashes(rel);
  }

  function absolutePathForRelativePath(relativePath, assetRoot) {
    if (!relativePath || !assetRoot) return null;
    const root = String(assetRoot).replace(/[\\/]+$/g, "");
    const rel = String(relativePath).replace(/^[\\/]+/, "");
    const sep = root.includes("\\") ? "\\" : "/";
    return root + sep + rel.replace(/[\\/]+/g, sep);
  }

  if (typeof Zotero !== "undefined") {
    Zotero.ZotLink = Zotero.ZotLink || {};
    Zotero.ZotLink.paths = {
      ITEM_ROOT,
      toForwardSlashes,
      trimSlashes,
      basename,
      normalizeParentKey,
      itemRoot,
      sourceDir,
      translationsDir,
      mdDir,
      hasExisting,
      nextSupplementNumber,
      supplementFilename,
      targetPathForRole,
      relativeAttachmentPath,
      absolutePathForRelativePath
    };
  }
})();
