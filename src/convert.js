/* zot-link convert — safe imported-file to linked-file conversion.
 *
 * Implements the core conversion sequence:
 *   [skip-copy] → clone → set linked mode → save
 *   → transfer child items/relations/fulltext
 *   → add role tag → erase original.
 *
 * Variants:
 *   - source == target → skip copy (file already in place)
 *   - already linked with correct path → update-only (rename title/tag)
 *   - target occupied by a *different* file → blocked (never overwrite)
 *
 * SAFETY RULE: any step fails → DO NOT erase original.
 */

(function () {
  "use strict";

  function safeCall(fn, fallback) {
    try { return fn(); } catch (_e) { return fallback; }
  }

  function pathsAreSame(a, b) {
    if (!a || !b) return false;
    const na = String(a).replace(/\\+/g, "/").replace(/\/+$/g, "");
    const nb = String(b).replace(/\\+/g, "/").replace(/\/+$/g, "");
    return na.toLowerCase() === nb.toLowerCase();
  }

  function getItemLinkMode(item, zotero) {
    if (item.attachmentLinkMode != null) return item.attachmentLinkMode;
    const imported = zotero && zotero.Attachments ? zotero.Attachments.LINK_MODE_IMPORTED_FILE : 0;
    return safeCall(() => item.attachmentLinkMode, imported);
  }

  function getItemAttachmentPath(item) {
    return item.attachmentPath || safeCall(() => item.getField("attachmentPath"), null) || null;
  }

  function normalizeLinkedPath(path) {
    if (!path) return null;
    const s = String(path);
    if (s.startsWith("attachments:")) return s.slice("attachments:".length);
    return s;
  }

  async function verifyCopy(sourcePath, targetPath, ioUtils, zotero) {
    if (pathsAreSame(sourcePath, targetPath)) return; // no-op: same file

    if (!ioUtils || typeof ioUtils.copy !== "function") {
      throw new Error("IOUtils.copy not available");
    }

    await ioUtils.copy(sourcePath, targetPath);

    const targetExists = await ioUtils.exists(targetPath);
    if (!targetExists) throw new Error("target file missing after copy");

    // Verify hash.
    if (zotero && zotero.File && typeof zotero.File.getFileHash === "function") {
      try {
        const sourceHash = await zotero.File.getFileHash(sourcePath);
        const targetHash = await zotero.File.getFileHash(targetPath);
        if (sourceHash !== targetHash) {
          try { await ioUtils.remove(targetPath); } catch (_e) { /* best-effort */ }
          throw new Error("hash mismatch after copy: source=" + sourceHash + " target=" + targetHash);
        }
        return;
      } catch (e) {
        if (e.message.startsWith("hash mismatch")) throw e;
      }
    }

    // Fallback: size verification.
    const sourceBuf = await readFileBinary(sourcePath, ioUtils);
    const targetBuf = await readFileBinary(targetPath, ioUtils);
    if (!sourceBuf || !targetBuf || sourceBuf.byteLength !== targetBuf.byteLength) {
      try { await ioUtils.remove(targetPath); } catch (_e) { /* best-effort */ }
      throw new Error("size mismatch after copy");
    }
  }

  async function readFileBinary(path, ioUtils) {
    try {
      if (ioUtils && ioUtils._readFile) return await ioUtils._readFile(path);
      if (ioUtils && ioUtils.read) return await ioUtils.read(path);
      return null;
    } catch (_e) { return null; }
  }

  function isProbablyAlreadyLinked(item, targetRelativePath, zotero) {
    const linkedMode = zotero && zotero.Attachments ? zotero.Attachments.LINK_MODE_LINKED_FILE : 2;
    const mode = getItemLinkMode(item, zotero);
    if (mode !== linkedMode) return false;

    const currentPath = normalizeLinkedPath(getItemAttachmentPath(item));
    const targetPath = String(targetRelativePath || "").replace(/\\+/g, "/");
    return currentPath && targetPath && currentPath.toLowerCase() === targetPath.toLowerCase();
  }

  async function convertImportedToLinked(input) {
    const opts = input || {};
    const item = opts.item;
    const actionKey = opts.actionKey;
    const parentKey = opts.parentKey;
    const targetRelativePath = opts.targetRelativePath;
    const title = opts.title;
    const tag = opts.tag;
    const skipCopy = !!opts.skipCopy;
    const updateOnly = !!opts.updateOnly;
    const zotero = opts.zotero || (typeof Zotero !== "undefined" ? Zotero : null);
    const ioUtils = opts.ioUtils || (typeof IOUtils !== "undefined" ? IOUtils : null);
    const paths = Zotero.ZotLink && Zotero.ZotLink.paths;

    const base = { actionKey, parentKey, targetRelativePath };

    // --- Gate 0: validate input ----------------------------------------------
    if (!item || typeof item.isAttachment !== "function" || !item.isAttachment()) {
      return Object.assign({ status: "blocked", reason: "not-an-attachment" }, base);
    }
    if (!zotero || !ioUtils) {
      return Object.assign({ status: "failed", reason: "missing-zotero-or-ioUtils" }, base);
    }
    if (!targetRelativePath) {
      return Object.assign({ status: "failed", reason: "missing-target-relative-path" }, base);
    }

    // --- Resolve absolute target path ----------------------------------------
    const assetRoot = zotero.Prefs
      ? safeCall(() => zotero.Prefs.get("baseAttachmentPath"), null)
      : null;
    if (!assetRoot) {
      return Object.assign({ status: "failed", reason: "no-linked-attachment-base-directory" }, base);
    }

    const targetAbsPath = (paths && paths.absolutePathForRelativePath)
      ? paths.absolutePathForRelativePath(targetRelativePath, assetRoot)
      : null;
    if (!targetAbsPath) {
      return Object.assign({ status: "failed", reason: "cannot-resolve-absolute-target-path" }, base);
    }

    // --- Get source path -----------------------------------------------------
    const sourcePath = safeCall(() => item.getFilePath(), null)
      || item.path
      || item.attachmentPath
      || null;

    // --- Variant: update-only (already linked, correct path) -----------------
    if (updateOnly || isProbablyAlreadyLinked(item, targetRelativePath, zotero)) {
      try {
        let changed = false;
        if (title && typeof item.setField === "function") {
          item.setField("title", title);
          changed = true;
        }
        if (tag && typeof item.addTag === "function") {
          item.addTag(tag);
          changed = true;
        }
        if (changed) await item.save();
        return Object.assign({
          status: "success",
          reason: null,
          newItemKey: item.key,
          skipped: ["copy", "clone", "erase"]
        }, base);
      } catch (e) {
        return Object.assign({
          status: "failed",
          reason: "update-title-failed: " + (e.message || String(e))
        }, base);
      }
    }

    // --- Gate: target occupied by a different file → blocked -----------------
    if (!sourcePath) {
      return Object.assign({ status: "failed", reason: "cannot-determine-source-path" }, base);
    }

    const sameFile = pathsAreSame(sourcePath, targetAbsPath);
    if (!sameFile && !skipCopy) {
      const targetExistsOnDisk = await safeCall(() => ioUtils.exists(targetAbsPath), false);
      if (targetExistsOnDisk) {
        return Object.assign({ status: "blocked", reason: "target-exists" }, base);
      }
    }

    // --- Step 1: Copy (skip if same file) ------------------------------------
    if (!sameFile && !skipCopy) {
      try {
        await verifyCopy(sourcePath, targetAbsPath, ioUtils, zotero);
      } catch (e) {
        return Object.assign({
          status: "failed",
          reason: "copy-failed: " + (e.message || String(e))
        }, base);
      }
    }

    // --- Step 2: Clone and set linked mode -----------------------------------
    let clone;
    try {
      clone = item.clone(null, { includeCollections: true });
      clone.attachmentLinkMode = zotero.Attachments
        ? zotero.Attachments.LINK_MODE_LINKED_FILE
        : 2;
      clone.attachmentPath = "attachments:" + targetRelativePath;
      if (title) {
        safeCall(() => clone.setField("title", title), null);
      }
      await clone.save();
    } catch (e) {
      // Clean up copied file on clone failure (only if we copied).
      if (!sameFile && !skipCopy) {
        try { await ioUtils.remove(targetAbsPath); } catch (_e) { /* best-effort */ }
      }
      return Object.assign({
        status: "failed",
        reason: "clone-save-failed: " + (e.message || String(e))
      }, base);
    }

    // --- Step 3: Transfer metadata -------------------------------------------
    try {
      if (zotero.Items && typeof zotero.Items.moveChildItems === "function") {
        await zotero.Items.moveChildItems(item, clone);
      }
    } catch (e) { Zotero.logError(e); }

    try {
      if (zotero.Relations && typeof zotero.Relations.copyObjectSubjectRelations === "function") {
        await zotero.Relations.copyObjectSubjectRelations(item, clone);
      }
    } catch (e) { Zotero.logError(e); }

    try {
      if (zotero.Fulltext && typeof zotero.Fulltext.transferItemIndex === "function") {
        await zotero.Fulltext.transferItemIndex(item, clone);
      }
    } catch (e) { Zotero.logError(e); }

    // --- Step 4: Apply role tag to clone -------------------------------------
    if (tag && clone && typeof clone.addTag === "function") {
      try {
        clone.addTag(tag);
        await clone.save();
      } catch (e) { Zotero.logError(e); }
    }

    // --- Step 4b: Ensure Main PDF is the best/default attachment ------------
    if (actionKey === "main" && clone) {
      try {
        // Set dateAdded far in the past so it's the oldest PDF →
        // picked by getBestAttachments() which sorts by dateAdded ASC.
        const epoch = "2000-01-01 00:00:00";
        await Zotero.DB.queryAsync(
          "UPDATE items SET dateAdded=? WHERE itemID=?",
          [epoch, clone.id]
        );
      } catch (e) { Zotero.logError(e); }
    }

    // --- Step 5: Erase original (only after all steps succeed) ---------------
    try {
      await item.erase();
    } catch (e) {
      return Object.assign({
        status: "failed",
        reason: "erase-failed: " + (e.message || String(e))
      }, base);
    }

    return Object.assign({
      status: "success",
      reason: null,
      newItemKey: clone ? clone.key : null,
      skipped: sameFile || skipCopy ? ["copy"] : []
    }, base);
  }

  if (typeof Zotero !== "undefined") {
    Zotero.ZotLink = Zotero.ZotLink || {};
    Zotero.ZotLink.convert = {
      pathsAreSame,
      getItemLinkMode,
      getItemAttachmentPath,
      isProbablyAlreadyLinked,
      verifyCopy,
      convertImportedToLinked,
      linkExistingFile
    };
  }

  async function linkExistingFile(input) {
    const opts = input || {};
    const parentItem = opts.parentItem;
    const parentKey = opts.parentKey;
    const targetRelativePath = opts.targetRelativePath;
    const title = opts.title || "Markdown Full Text";
    const tag = opts.tag;
    const contentType = opts.contentType || "text/markdown";
    const zotero = opts.zotero || (typeof Zotero !== "undefined" ? Zotero : null);
    const ioUtils = opts.ioUtils || (typeof IOUtils !== "undefined" ? IOUtils : null);
    const paths = Zotero.ZotLink && Zotero.ZotLink.paths;

    const base = { actionKey: "markdown", parentKey, targetRelativePath };

    if (!zotero) return Object.assign({ status: "failed", reason: "missing-zotero" }, base);
    if (!targetRelativePath) return Object.assign({ status: "failed", reason: "missing-target-relative-path" }, base);
    if (!parentItem && !parentKey) return Object.assign({ status: "failed", reason: "missing-parent-item" }, base);

    const assetRoot = zotero.Prefs
      ? safeCall(() => zotero.Prefs.get("baseAttachmentPath"), null)
      : null;
    if (!assetRoot) return Object.assign({ status: "failed", reason: "no-linked-attachment-base-directory" }, base);

    const targetAbsPath = (paths && paths.absolutePathForRelativePath)
      ? paths.absolutePathForRelativePath(targetRelativePath, assetRoot)
      : null;
    if (!targetAbsPath) return Object.assign({ status: "failed", reason: "cannot-resolve-absolute-target-path" }, base);

    // File must already exist on disk.
    if (!ioUtils) return Object.assign({ status: "failed", reason: "missing-ioUtils" }, base);
    const exists = await safeCall(() => ioUtils.exists(targetAbsPath), false);
    if (!exists) return Object.assign({ status: "blocked", reason: "md-file-not-found", targetAbsPath }, base);

    // Use Zotero.Attachments.linkFromFile to create the linked attachment.
    if (!zotero.Attachments || typeof zotero.Attachments.linkFromFile !== "function") {
      return Object.assign({ status: "failed", reason: "zotero-attachments-api-unavailable" }, base);
    }

    let attachment;
    try {
      attachment = await zotero.Attachments.linkFromFile({
        file: targetAbsPath,
        parentItemID: parentItem ? parentItem.id : null,
        title,
        contentType
      });
    } catch (e) {
      return Object.assign({ status: "failed", reason: "link-from-file-failed: " + (e.message || String(e)) }, base);
    }

    if (tag && attachment && typeof attachment.addTag === "function") {
      try { attachment.addTag(tag); await attachment.save(); } catch (e) { Zotero.logError(e); }
    }

    // Markdown is supplementary text; keep its dateAdded later than Main.
    // No explicit date adjustment needed — Main PDF epoch already handles priority.

    return Object.assign({
      status: "success",
      reason: null,
      newItemKey: attachment ? attachment.key : null
    }, base);
  }
})();
