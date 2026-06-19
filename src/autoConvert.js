/* zot-link autoConvert — tag-triggered automatic attachment conversion.
 *
 * Registers a Zotero Notifier observer that watches for role tags
 * (role/main, role/translation, role/supplement) added to imported-file
 * attachments. When detected, runs the same safe conversion pipeline
 * as the right-click menu, but without user confirmation.
 *
 * Results are logged to _items/{PARENT_KEY}/meta/zot-link-log.jsonl.
 */

(function () {
  "use strict";

  const WATCHED_TAGS = Object.freeze(["role/main", "role/translation", "role/supplement"]);
  const TAG_TO_ACTION = Object.freeze({
    "role/main": "main",
    "role/translation": "translation",
    "role/supplement": "supplement"
  });

  let _notifierID = null;
  let _enabled = false;
  let _lastEvent = null;
  let _lastHandled = null;
  let _lastError = null;
  let _lastParsedIDs = null;
  let _lastSkipped = null;

  let ConsoleServices = null;
  try {
    ConsoleServices = ChromeUtils.importESModule("resource://gre/modules/Services.sys.mjs").Services;
  } catch (_e) { /* Services may be unavailable in tests */ }

  function log() {
    const msg = "[zot-link:auto] " + Array.prototype.join.call(arguments, " ");
    if (ConsoleServices && ConsoleServices.console) {
      ConsoleServices.console.logStringMessage(msg);
    }
    if (typeof Zotero !== "undefined" && Zotero.debug) {
      Zotero.debug(msg);
    }
  }

  function safeCall(fn, fallback) {
    try { return fn(); } catch (_e) { return fallback; }
  }

  async function getAssetRoot() {
    if (!Zotero || !Zotero.Prefs) return null;
    const root = safeCall(() => Zotero.Prefs.get("baseAttachmentPath"), null);
    return root || null;
  }

  async function resolveAbsPath(relativePath) {
    const assetRoot = await getAssetRoot();
    if (!assetRoot || !relativePath) return null;
    const p = Zotero.ZotLink && Zotero.ZotLink.paths;
    if (!p || !p.absolutePathForRelativePath) return null;
    return p.absolutePathForRelativePath(relativePath, assetRoot);
  }

  async function writeLogEntry(parentKey, entry) {
    if (!parentKey) return;
    const assetRoot = await getAssetRoot();
    if (!assetRoot) return;

    const p = Zotero.ZotLink && Zotero.ZotLink.paths;
    const logDir = p ? p.itemRoot(parentKey) + "/meta" : "_items/" + parentKey + "/meta";
    const absLogDir = await resolveAbsPath(logDir);
    if (!absLogDir) return;

    const logFile = absLogDir + "/zot-link-log.jsonl";
    try {
      const IOUtils = typeof Components !== "undefined"
        ? ChromeUtils.importESModule("resource://gre/modules/IOUtils.sys.mjs").IOUtils
        : null;
      if (!IOUtils) return;

      // Ensure directory exists.
      const PathUtils = ChromeUtils.importESModule("resource://gre/modules/PathUtils.sys.mjs").PathUtils;
      const parentDir = PathUtils.parent(logFile);
      try { await IOUtils.makeDirectory(parentDir, { createAncestors: true }); } catch (_e) { /* ok */ }

      const line = JSON.stringify(entry) + "\n";
      const encoder = new TextEncoder();
      const bytes = encoder.encode(line);

      // Append to file.
      let existing = new Uint8Array(0);
      try { existing = await IOUtils.read(logFile); } catch (_e) { /* file doesn't exist yet */ }
      const combined = new Uint8Array(existing.length + bytes.length);
      combined.set(existing, 0);
      combined.set(bytes, existing.length);
      await IOUtils.write(logFile, combined);
    } catch (e) {
      log("log write error:", e.message || String(e));
    }
  }

  function extractRoleFromTags(tags) {
    for (const tag of (tags || [])) {
      const t = String(tag.tag || tag).trim().toLowerCase();
      if (WATCHED_TAGS.includes(t)) return t;
    }
    return null;
  }

  function parseNotifierItemID(rawID, type, extraData) {
    if (type === "item-tag") {
      // Zotero item-tag notifier ids are compound strings such as
      // "<tagID>-<itemID>". The attachment itemID is the second half.
      const str = String(rawID);
      if (str.includes("-")) {
        const parsed = parseInt(str.split("-").pop(), 10);
        if (Number.isInteger(parsed)) return parsed;
      }
      if (extraData && extraData[rawID] && extraData[rawID].itemID) {
        const parsed = parseInt(extraData[rawID].itemID, 10);
        if (Number.isInteger(parsed)) return parsed;
      }
    }
    const parsed = parseInt(rawID, 10);
    return Number.isInteger(parsed) ? parsed : null;
  }

  async function handleAutoConvert(itemID) {
    if (!_enabled) return;

    let item;
    try {
      item = Zotero.Items.get(itemID);
      if (!item || typeof item.isAttachment !== "function" || !item.isAttachment()) {
        _lastSkipped = "item " + itemID + " is not an attachment";
        return;
      }
    } catch (e) {
      _lastError = "cannot get item " + itemID + ": " + (e.message || String(e));
      log(_lastError);
      return;
    }

    // Ensure item data is loaded before reading tags/mode.
    try {
      if (typeof item.loadDataType === "function") {
        await item.loadDataType("itemData");
      }
      if (typeof item.loadPrimaryData === "function") {
        await item.loadPrimaryData();
      }
    } catch (_e) { /* proceed with whatever we have */ }

    // Only convert imported files; skip already-linked ones.
    const linkedMode = Zotero.Attachments ? Zotero.Attachments.LINK_MODE_LINKED_FILE : 2;
    const importedMode = Zotero.Attachments ? Zotero.Attachments.LINK_MODE_IMPORTED_FILE : 0;
    const currentMode = safeCall(() => item.attachmentLinkMode, null);
    log("item", itemID, "linkMode:", currentMode);
    if (currentMode !== importedMode && currentMode !== null) {
      _lastSkipped = "item " + itemID + " not imported_file, mode=" + currentMode;
      log("skipping item", itemID, "- not imported_file (mode:", currentMode, ")");
      return;
    }

    // Extract role tag from the item's current tags.
    let tags;
    try { tags = item.getTags ? item.getTags() : []; } catch (_e) { tags = []; }
    log("item", itemID, "tags:", JSON.stringify(tags));
    const roleTag = extractRoleFromTags(tags);
    if (!roleTag) {
      _lastSkipped = "item " + itemID + " has no watched role tag";
      return;
    }

    const actionKey = TAG_TO_ACTION[roleTag];
    if (!actionKey) return;

    log("auto-convert item", itemID, "role", roleTag, "→", actionKey);
    _lastHandled = { itemID, roleTag, actionKey, at: new Date().toISOString() };

    // Run preflight.
    const preview = Zotero.ZotLink && Zotero.ZotLink.preview;
    const convert = Zotero.ZotLink && Zotero.ZotLink.convert;
    if (!preview || !convert) return;

    const sel = {
      count: 1,
      hasAttachment: true,
      hasParent: false,
      hasNote: false,
      items: [item]
    };

    let preflightResult;
    try {
      const IOUtils = typeof Components !== "undefined"
        ? ChromeUtils.importESModule("resource://gre/modules/IOUtils.sys.mjs").IOUtils
        : null;
      preflightResult = await preview.previewForSelectionWithPreflight(actionKey, sel, Zotero, IOUtils);
    } catch (e) {
      log("preflight error:", e.message || String(e));
      _lastError = "preflight: " + (e.message || String(e));
      await writeLogEntry(null, {
        timestamp: new Date().toISOString(),
        action: "convert-imported-to-linked",
        attachment_key_old: item.key || null,
        role: actionKey,
        status: "failed",
        error: "preflight: " + (e.message || String(e))
      });
      return;
    }

    if (preflightResult.status === "blocked") {
      log("auto-convert blocked:", preflightResult.reason);
      _lastError = "blocked: " + preflightResult.reason;
      await writeLogEntry(preflightResult.parentKey, {
        timestamp: new Date().toISOString(),
        action: "convert-imported-to-linked",
        parent_key: preflightResult.parentKey,
        attachment_key_old: item.key || null,
        role: actionKey,
        target_path: preflightResult.targetRelativePath,
        status: "blocked",
        error: preflightResult.reason
      });
      return;
    }

    // Execute conversion.
    let result;
    try {
      result = await convert.convertImportedToLinked({
        item,
        actionKey,
        parentKey: preflightResult.parentKey,
        targetRelativePath: preflightResult.targetRelativePath,
        title: preflightResult.title,
        tag: preflightResult.tag,
        skipCopy: !!preflightResult.skipCopy,
        updateOnly: !!preflightResult.updateOnly
      });
    } catch (e) {
      result = { status: "failed", reason: "exception: " + (e.message || String(e)) };
    }

    log("auto-convert result:", result.status, result.reason || "");
    _lastError = result.status === "success" ? null : result.reason || result.status;

    // Write log entry.
    const logEntry = {
      timestamp: new Date().toISOString(),
      action: "convert-imported-to-linked",
      parent_key: preflightResult.parentKey || result.parentKey || null,
      attachment_key_old: item.key || null,
      attachment_key_new: result.newItemKey || null,
      role: actionKey,
      target_path: result.targetRelativePath || preflightResult.targetRelativePath || null,
      status: result.status,
      error: result.reason || null
    };

    await writeLogEntry(logEntry.parent_key, logEntry);
  }

  // Debounce: Zotero fires multiple tag events per change. Group by itemID.
  let _pending = new Set();
  let _timer = null;

  function scheduleConvert(itemID) {
    _pending.add(itemID);
    if (_timer) return;
    _timer = setTimeout(async () => {
      const ids = Array.from(_pending);
      _pending.clear();
      _timer = null;
      for (const id of ids) {
        try { await handleAutoConvert(id); } catch (e) { log("handler error:", e.message || String(e)); }
      }
    }, 200);
  }

  const observer = {
    notify(event, type, ids, extraData) {
      if (!_enabled) return;
      if (type !== "item-tag" && type !== "item") return;
      const rawIDs = Array.from(ids || []);
      const parsedIDs = rawIDs
        .map((id) => parseNotifierItemID(id, type, extraData))
        .filter((id) => id !== null);
      _lastEvent = { event, type, ids: rawIDs, at: new Date().toISOString() };
      _lastParsedIDs = parsedIDs;
      log("event:", event, "type:", type, "ids:", rawIDs.join(","), "parsed:", parsedIDs.join(","));
      for (const id of parsedIDs) {
        scheduleConvert(id);
      }
    }
  };

  function start() {
    if (_notifierID) return;
    try {
      _notifierID = Zotero.Notifier.registerObserver(observer, ["item-tag", "item"], "zot-link-auto");
      _enabled = true;
      log("Notifier started, id=" + _notifierID);
    } catch (e) {
      log("Notifier start failed: " + (e.message || String(e)));
    }
  }

  function stop() {
    _enabled = false;
    if (_timer) { clearTimeout(_timer); _timer = null; }
    _pending.clear();
    if (_notifierID) {
      try { Zotero.Notifier.unregisterObserver(_notifierID); } catch (_e) { /* noop */ }
      _notifierID = null;
    }
  }

  function isRunning() {
    return _enabled;
  }

  function getStatus() {
    return {
      running: _enabled,
      notifierID: _notifierID,
      watchedTags: WATCHED_TAGS,
      lastEvent: _lastEvent,
      lastParsedIDs: _lastParsedIDs,
      lastHandled: _lastHandled,
      lastError: _lastError,
      lastSkipped: _lastSkipped
    };
  }

  if (typeof Zotero !== "undefined") {
    Zotero.ZotLink = Zotero.ZotLink || {};
    Zotero.ZotLink.autoConvert = { start, stop, isRunning, getStatus, WATCHED_TAGS };
  }
})();
