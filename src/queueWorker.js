/* zot-link queueWorker — local JSON action queue for Hermes ↔ Zotero Desktop.
 *
 * Reads actions from:
 *   _agent/queues/zot-link-actions/pending/*.json
 *
 * Writes results to:
 *   _agent/queues/zot-link-actions/done/*.json
 *   _agent/queues/zot-link-actions/failed/*.json
 *
 * This module runs inside Zotero, so it can call Zotero attachment APIs directly
 * without relying on Zotero Web API sync.
 */

(function () {
  "use strict";

  const QUEUE_RELATIVE_ROOT = "_agent/queues/zot-link-actions";
  const DEFAULT_INTERVAL_MS = 5000;

  let _timer = null;
  let _running = false;
  let _lastRun = null;
  let _lastResults = [];
  let _lastError = null;
  let _lastAssetRoot = null;
  let _lastQueueDirs = null;
  let _lastPendingCount = null;
  let _busy = false; // 0.0.27: 一轮未完成时，定时器的下一轮直接跳过，防止两轮同时处理同一文件

  function log() {
    try {
      const msg = Array.from(arguments).join(" ");
      if (typeof Zotero !== "undefined" && Zotero.debug) Zotero.debug("[zot-link:queue] " + msg);
    } catch (_e) { /* noop */ }
  }

  function safeCall(fn, fallback) {
    try { return fn(); } catch (_e) { return fallback; }
  }

  function assetRootFromZotero(zotero) {
    if (!zotero || !zotero.Prefs || typeof zotero.Prefs.get !== "function") return null;
    const root = safeCall(() => zotero.Prefs.get("baseAttachmentPath"), null);
    return root ? String(root) : null;
  }

  function pathJoin(root) {
    const parts = Array.from(arguments).filter((p) => p != null && String(p) !== "").map(String);
    if (!parts.length) return "";
    const firstRaw = parts.shift();
    const sep = firstRaw.includes("\\") ? "\\" : "/";
    const first = firstRaw.replace(/[\\/]+$/g, "").replace(/[\\/]+/g, sep);
    return [first].concat(parts.map((p) => p.replace(/^[\\/]+|[\\/]+$/g, "").replace(/[\\/]+/g, sep))).join(sep);
  }

  function basename(path) {
    return String(path || "").replace(/\\+/g, "/").split("/").pop() || "action.json";
  }

  function queueDirs(assetRoot) {
    const root = pathJoin(assetRoot, QUEUE_RELATIVE_ROOT);
    return {
      root,
      pending: pathJoin(root, "pending"),
      done: pathJoin(root, "done"),
      failed: pathJoin(root, "failed")
    };
  }

  async function ensureDir(path, ioUtils) {
    if (!ioUtils || !path) return;
    if (typeof ioUtils.makeDirectory === "function") {
      try { await ioUtils.makeDirectory(path, { createAncestors: true }); } catch (_e) { /* exists or unsupported */ }
    }
  }

  async function readText(path, ioUtils) {
    if (ioUtils && typeof ioUtils.readUTF8 === "function") return await ioUtils.readUTF8(path);
    if (ioUtils && typeof ioUtils.read === "function") {
      const bytes = await ioUtils.read(path);
      if (typeof TextDecoder !== "undefined") return new TextDecoder("utf-8").decode(bytes);
    }
    throw new Error("IOUtils readUTF8/read unavailable");
  }

  async function writeText(path, text, ioUtils) {
    if (ioUtils && typeof ioUtils.writeUTF8 === "function") return await ioUtils.writeUTF8(path, text);
    if (ioUtils && typeof ioUtils.write === "function" && typeof TextEncoder !== "undefined") {
      return await ioUtils.write(path, new TextEncoder().encode(text));
    }
    throw new Error("IOUtils writeUTF8/write unavailable");
  }

  async function removeFile(path, ioUtils) {
    if (ioUtils && typeof ioUtils.remove === "function") {
      try { await ioUtils.remove(path); } catch (_e) { /* best-effort */ }
    }
  }

  async function listPending(dir, ioUtils) {
    if (!ioUtils) throw new Error("IOUtils unavailable");
    try {
      let children;
      if (typeof ioUtils.getChildren === "function") {
        children = await ioUtils.getChildren(dir);
      } else if (typeof ioUtils.getDirectoryEntries === "function") {
        children = await ioUtils.getDirectoryEntries(dir);
      } else if (typeof OS !== "undefined" && OS.File && OS.File.DirectoryIterator) {
        children = [];
        const iterator = new OS.File.DirectoryIterator(dir);
        try {
          await iterator.forEach((entry) => { children.push(entry.path); });
        } finally {
          iterator.close();
        }
      } else {
        throw new Error("no directory listing API: expected IOUtils.getChildren/getDirectoryEntries");
      }
      return (children || []).filter((p) => String(p).toLowerCase().endsWith(".json")).sort();
    } catch (e) {
      log("pending list failed:", e.message || String(e));
      throw e;
    }
  }

  function getCollectionByKey(key, zotero, libraryID) {
    if (!key || !zotero || !zotero.Collections) return null;
    if (typeof zotero.Collections.getByLibraryAndKey === "function") {
      const libID = libraryID || (zotero.Libraries && zotero.Libraries.userLibraryID) || null;
      if (libID != null) {
        const c = safeCall(() => zotero.Collections.getByLibraryAndKey(libID, key), null);
        if (c) return c;
      }
    }
    return null;
  }

  function getItemByKey(key, zotero, libraryID) {
    if (!key || !zotero || !zotero.Items) return null;
    if (typeof zotero.Items.getByKey === "function") {
      const item = safeCall(() => zotero.Items.getByKey(key), null);
      if (item) return item;
    }
    const libID = libraryID || (zotero.Libraries && zotero.Libraries.userLibraryID) || null;
    if (libID && typeof zotero.Items.getByLibraryAndKey === "function") {
      const item = safeCall(() => zotero.Items.getByLibraryAndKey(libID, key), null);
      if (item) return item;
    }
    return null;
  }

  function resultBase(action) {
    return {
      action_id: action.action_id || null,
      action: action.action || null,
      parent_key: action.parent_key || null,
      attachment_key: action.attachment_key || null,
      item_key: action.item_key || null,
      collection_key: action.collection_key || null,
      timestamp: new Date().toISOString()
    };
  }

  async function executeAction(action, deps) {
    const opts = deps || {};
    const zotero = opts.zotero || (typeof Zotero !== "undefined" ? Zotero : null);
    const ioUtils = opts.ioUtils || (typeof IOUtils !== "undefined" ? IOUtils : null);
    const convert = zotero && zotero.ZotLink && zotero.ZotLink.convert;
    const kind = String(action && action.action || "");
    const base = resultBase(action || {});

    if (!action || !kind) return Object.assign(base, { status: "failed", reason: "missing-action" });
    if (!zotero || !ioUtils || !convert) return Object.assign(base, { status: "failed", reason: "missing-runtime-dependencies" });

    if (kind === "attach-markdown") {
      const parentKey = action.parent_key;
      const parentItem = getItemByKey(parentKey, zotero, action.library_id);
      const targetRelativePath = action.target_relative_path || ("_items/" + parentKey + "/md/paper.md");
      if (!parentItem) return Object.assign(base, { status: "blocked", reason: "parent-not-found", target_relative_path: targetRelativePath });
      const result = await convert.linkExistingFile({
        parentItem,
        parentKey,
        targetRelativePath,
        title: action.title || "Markdown Full Text",
        tag: action.tag || null,
        contentType: action.content_type || "text/markdown",
        zotero,
        ioUtils
      });
      return Object.assign(base, {
        status: result.status,
        reason: result.reason || null,
        target_relative_path: result.targetRelativePath || targetRelativePath,
        new_attachment_key: result.newItemKey || null
      });
    }

    if (kind === "main-update-only") {
      const parentKey = action.parent_key;
      const attachmentKey = action.attachment_key;
      const attachment = getItemByKey(attachmentKey, zotero, action.library_id);
      const targetRelativePath = action.target_relative_path || ("_items/" + parentKey + "/source/main.pdf");
      if (!attachment) return Object.assign(base, { status: "blocked", reason: "attachment-not-found", target_relative_path: targetRelativePath });
      const result = await convert.convertImportedToLinked({
        item: attachment,
        actionKey: "main",
        parentKey,
        targetRelativePath,
        title: action.title || "Main PDF",
        tag: action.tag || "role/main",
        updateOnly: true,
        zotero,
        ioUtils
      });
      return Object.assign(base, {
        status: result.status,
        reason: result.reason || null,
        target_relative_path: result.targetRelativePath || targetRelativePath,
        new_attachment_key: result.newItemKey || null,
        skipped: result.skipped || null
      });
    }

    if (kind === "set-parent") {
      // Set an attachment's parent item LOCALLY. Zotero auto-removes it from collections
      // (child items can't belong to collections). Bypasses the Web API array-field limitation.
      const attachmentKey = action.attachment_key;
      const parentKey = action.parent_key;
      const attachment = getItemByKey(attachmentKey, zotero, action.library_id);
      const parent = getItemByKey(parentKey, zotero, action.library_id);
      if (!attachment) return Object.assign(base, { status: "blocked", reason: "attachment-not-found" });
      if (!parent) return Object.assign(base, { status: "blocked", reason: "parent-not-found" });
      if (!attachment.isAttachment || !attachment.isAttachment()) {
        return Object.assign(base, { status: "blocked", reason: "not-an-attachment" });
      }
      try {
        attachment.parentItemID = parent.id;
        if (action.title) attachment.setField("title", action.title);
        if (attachment.saveTx) { await attachment.saveTx(); }
        else { await Zotero.DB.executeTransaction(async () => { await attachment.save(); }); }
      } catch (e) {
        return Object.assign(base, { status: "failed", reason: "set-parent-failed: " + (e.message || String(e)) });
      }
      return Object.assign(base, { status: "success", reason: null, attachment_key: attachmentKey, parent_key: parentKey });
    }

    if (kind === "erase-attachment") {
      // Safely erase an attachment item LOCALLY (bypasses Web API not_found mismatch).
      // SAFETY GUARD: only erases linked-file attachments whose target file does NOT exist.
      // Refuses to erase if the linked file is present on disk (protects valid attachments).
      const attachmentKey = action.attachment_key;
      const attachment = getItemByKey(attachmentKey, zotero, action.library_id);
      if (!attachment) return Object.assign(base, { status: "success", reason: "already-absent" });
      if (!attachment.isAttachment || !attachment.isAttachment()) {
        return Object.assign(base, { status: "blocked", reason: "not-an-attachment" });
      }
      // Resolve linked file existence
      let fileExists = false;
      let resolvedPath = null;
      try {
        const f = attachment.getFilePath ? attachment.getFilePath() : null;
        if (f) {
          resolvedPath = String(f);
          fileExists = await safeCall(async () => await ioUtils.exists(resolvedPath), false);
          if (fileExists && fileExists.then) fileExists = await fileExists;
        }
      } catch (_e) { fileExists = false; }
      // Optional explicit override: action.force === true erases regardless
      if (fileExists && action.force !== true) {
        return Object.assign(base, { status: "blocked", reason: "linked-file-exists", resolved_path: resolvedPath });
      }
      try {
        await attachment.eraseTx ? await attachment.eraseTx() : await attachment.erase();
      } catch (e) {
        return Object.assign(base, { status: "failed", reason: "erase-failed: " + (e.message || String(e)) });
      }
      return Object.assign(base, { status: "success", reason: null, erased: attachmentKey, resolved_path: resolvedPath });
    }

    if (kind === "remove-from-collection") {
      // Remove an item from a collection LOCALLY (in-process Zotero API).
      // The Web API can't do this (collections is an array field → 400), so this
      // bridges the gap. Item keeps all OTHER collection memberships and is NOT trashed.
      const itemKey = action.item_key || action.attachment_key;
      const collectionKey = action.collection_key;
      const item = getItemByKey(itemKey, zotero, action.library_id);
      const collection = getCollectionByKey(collectionKey, zotero, action.library_id);
      if (!item) return Object.assign(base, { status: "blocked", reason: "item-not-found", item_key: itemKey, collection_key: collectionKey });
      if (!collection) return Object.assign(base, { status: "blocked", reason: "collection-not-found", item_key: itemKey, collection_key: collectionKey });
      // Idempotency: if not a member, report success (nothing to do).
      let isMember = false;
      try {
        if (typeof item.getCollections === "function") {
          const cols = item.getCollections() || [];
          isMember = cols.indexOf(collection.id) !== -1;
        }
      } catch (_e) { isMember = false; }
      if (!isMember) {
        return Object.assign(base, { status: "success", reason: "not-a-member", item_key: itemKey, collection_key: collectionKey });
      }
      try {
        // Prefer item.removeFromCollection + saveTx (self-contained transaction).
        // collection.removeItems()/removeItem() must run INSIDE a DB transaction,
        // so wrap those in executeTransaction (bare calls throw "Not in transaction").
        if (typeof item.removeFromCollection === "function" && (item.saveTx || (zotero.DB && zotero.DB.executeTransaction))) {
          item.removeFromCollection(collection.id);
          if (item.saveTx) { await item.saveTx(); }
          else { await zotero.DB.executeTransaction(async () => { await item.save(); }); }
        } else if (typeof collection.removeItems === "function" && zotero.DB && zotero.DB.executeTransaction) {
          await zotero.DB.executeTransaction(async () => { await collection.removeItems([item.id]); });
        } else if (typeof collection.removeItem === "function" && zotero.DB && zotero.DB.executeTransaction) {
          await zotero.DB.executeTransaction(async () => { await collection.removeItem(item.id); });
        } else if (typeof collection.removeItems === "function") {
          await collection.removeItems([item.id]);
        } else {
          return Object.assign(base, { status: "failed", reason: "no-remove-api-available", item_key: itemKey, collection_key: collectionKey });
        }
      } catch (e) {
        return Object.assign(base, { status: "failed", reason: "remove-failed: " + (e.message || String(e)), item_key: itemKey, collection_key: collectionKey });
      }
      return Object.assign(base, { status: "success", reason: null, item_key: itemKey, collection_key: collectionKey });
    }

    return Object.assign(base, { status: "failed", reason: "unknown-action" });
  }

  async function writeResultForAction(actionPath, action, result, dirs, ioUtils) {
    const success = result && result.status === "success";
    const outDir = success ? dirs.done : dirs.failed;
    await ensureDir(outDir, ioUtils);
    const outPath = pathJoin(outDir, basename(actionPath));
    const payload = Object.assign({}, action || {}, { result });
    await writeText(outPath, JSON.stringify(payload, null, 2), ioUtils);
    await removeFile(actionPath, ioUtils);
    return outPath;
  }

  async function processActionFile(actionPath, dirs, deps) {
    const ioUtils = deps.ioUtils || (typeof IOUtils !== "undefined" ? IOUtils : null);
    let action;
    try {
      action = JSON.parse(await readText(actionPath, ioUtils));
    } catch (e) {
      action = { action_id: basename(actionPath), action: "parse" };
      const result = Object.assign(resultBase(action), { status: "failed", reason: "parse-failed: " + (e.message || String(e)) });
      await writeResultForAction(actionPath, action, result, dirs, ioUtils);
      return result;
    }
    const result = await executeAction(action, deps);
    await writeResultForAction(actionPath, action, result, dirs, ioUtils);
    return result;
  }

  async function processPendingOnce(deps) {
    if (_busy) return [];
    _busy = true;
    try {
      return await processPendingOnceUnguarded(deps);
    } finally {
      _busy = false;
    }
  }

  async function processPendingOnceUnguarded(deps) {
    const opts = deps || {};
    const zotero = opts.zotero || (typeof Zotero !== "undefined" ? Zotero : null);
    const ioUtils = opts.ioUtils || (typeof IOUtils !== "undefined" ? IOUtils : null);
    const assetRoot = opts.assetRoot || assetRootFromZotero(zotero);
    _lastAssetRoot = assetRoot || null;
    if (!assetRoot) {
      _lastError = "no-linked-attachment-base-directory";
      _lastResults = [];
      _lastPendingCount = null;
      return [];
    }
    const dirs = queueDirs(assetRoot);
    _lastQueueDirs = dirs;
    await ensureDir(dirs.pending, ioUtils);
    await ensureDir(dirs.done, ioUtils);
    await ensureDir(dirs.failed, ioUtils);
    let pending;
    try {
      pending = await listPending(dirs.pending, ioUtils);
      _lastPendingCount = pending.length;
    } catch (e) {
      _lastError = "list-pending-failed: " + (e.message || String(e));
      _lastPendingCount = null;
      _lastResults = [];
      _lastRun = new Date().toISOString();
      return [];
    }
    const results = [];
    for (const path of pending) {
      try {
        results.push(await processActionFile(path, dirs, { zotero, ioUtils }));
      } catch (e) {
        const result = { action_id: basename(path), action: null, status: "failed", reason: "worker-exception: " + (e.message || String(e)), timestamp: new Date().toISOString() };
        results.push(result);
      }
    }
    _lastRun = new Date().toISOString();
    _lastResults = results;
    _lastError = null;
    return results;
  }

  function start(intervalMs) {
    if (_running) return;
    _running = true;
    const interval = intervalMs || DEFAULT_INTERVAL_MS;
    // Run once shortly after startup, then poll.
    Promise.resolve().then(() => processPendingOnce()).catch((e) => { _lastError = e.message || String(e); log("initial run failed:", _lastError); });
    _timer = setInterval(() => {
      processPendingOnce().catch((e) => { _lastError = e.message || String(e); log("poll failed:", _lastError); });
    }, interval);
    log("started interval=" + interval);
  }

  function stop() {
    _running = false;
    if (_timer) {
      clearInterval(_timer);
      _timer = null;
    }
  }

  function isRunning() { return _running; }

  function getStatus() {
    return {
      running: _running,
      intervalMs: DEFAULT_INTERVAL_MS,
      queueRelativeRoot: QUEUE_RELATIVE_ROOT,
      lastAssetRoot: _lastAssetRoot,
      lastQueueDirs: _lastQueueDirs,
      lastPendingCount: _lastPendingCount,
      lastRun: _lastRun,
      lastResults: _lastResults,
      lastError: _lastError
    };
  }

  if (typeof Zotero !== "undefined") {
    Zotero.ZotLink = Zotero.ZotLink || {};
    Zotero.ZotLink.queueWorker = {
      QUEUE_RELATIVE_ROOT,
      queueDirs,
      getItemByKey,
      executeAction,
      processPendingOnce,
      start,
      stop,
      isRunning,
      getStatus
    };
  }
})();
