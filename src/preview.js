/* zot-link preview — dry-run target preview helpers.
 *
 * This module only computes and formats intended actions. It does not touch the
 * filesystem and does not create/update/delete Zotero items.
 */

(function () {
  "use strict";

  const ACTION_ROLE = Object.freeze({
    main: "main",
    translation: "translation",
    supplement: "supplement",
    markdown: "markdown"
  });

  function roles() {
    return Zotero.ZotLink && Zotero.ZotLink.roles;
  }

  function paths() {
    return Zotero.ZotLink && Zotero.ZotLink.paths;
  }

  function actionToRole(actionKey) {
    const role = ACTION_ROLE[String(actionKey || "")];
    return role || null;
  }

  function safeCall(fn, fallback) {
    try { return fn(); } catch (_e) { return fallback; }
  }

  function itemIsAttachment(item) {
    return !!(item && typeof item.isAttachment === "function" && item.isAttachment());
  }

  function itemIsParent(item) {
    return !!(item && typeof item.isRegularItem === "function" && item.isRegularItem());
  }

  function itemIsNote(item) {
    return !!(item && typeof item.isNote === "function" && item.isNote());
  }

  function getParentKeyForItem(item, zotero) {
    if (!item) return null;
    if (itemIsParent(item)) return item.key || null;
    if (item.parentKey) return item.parentKey;
    if (item.parentItem && item.parentItem.key) return item.parentItem.key;
    if (item.parentID && zotero && zotero.Items && typeof zotero.Items.get === "function") {
      const parent = safeCall(() => zotero.Items.get(item.parentID), null);
      if (parent && parent.key) return parent.key;
    }
    if (typeof item.getSource === "function" && zotero && zotero.Items && typeof zotero.Items.get === "function") {
      const parentID = safeCall(() => item.getSource(), null);
      if (parentID) {
        const parent = safeCall(() => zotero.Items.get(parentID), null);
        if (parent && parent.key) return parent.key;
      }
    }
    return null;
  }

  function getCurrentPath(item) {
    if (!item) return null;
    if (typeof item.getFilePath === "function") {
      const p = safeCall(() => item.getFilePath(), null);
      if (p) return String(p);
    }
    if (item.attachmentPath) return String(item.attachmentPath);
    if (item.path) return String(item.path);
    return null;
  }

  function getAttachmentFilename(item) {
    if (!item) return "attachment.pdf";
    if (item.attachmentFilename) return String(item.attachmentFilename);
    const currentPath = getCurrentPath(item);
    if (currentPath && paths() && paths().basename) return paths().basename(currentPath) || "attachment.pdf";
    if (typeof item.getField === "function") {
      const title = safeCall(() => item.getField("title"), null);
      if (title) return String(title);
    }
    if (item.title) return String(item.title);
    return "attachment.pdf";
  }

  function assetRootFromZotero(zotero) {
    if (!zotero || !zotero.Prefs || typeof zotero.Prefs.get !== "function") return null;
    const root = safeCall(() => zotero.Prefs.get("baseAttachmentPath"), null);
    return root ? String(root) : null;
  }

  function absolutePathForRelativePath(relativePath, assetRoot) {
    if (!relativePath || !assetRoot) return null;
    const root = String(assetRoot).replace(/[\\/]+$/g, "");
    const rel = String(relativePath).replace(/^[\\/]+/g, "");
    const sep = root.includes("\\") ? "\\" : "/";
    return root + sep + rel.replace(/[\\/]+/g, sep);
  }

  async function pathExists(relativePath, assetRoot, ioUtils) {
    const absPath = absolutePathForRelativePath(relativePath, assetRoot);
    if (!absPath || !ioUtils || typeof ioUtils.exists !== "function") return false;
    return !!(await ioUtils.exists(absPath));
  }

  async function collectExistingRelativePaths(input) {
    const opts = input || {};
    const role = actionToRole(opts.actionKey);
    const pathHelpers = paths();
    const parentKey = opts.parentKey;
    const assetRoot = opts.assetRoot;
    const ioUtils = opts.ioUtils;
    if (!role || !pathHelpers || !parentKey || !assetRoot || !ioUtils) return [];

    const candidates = [];
    if (role === "main") {
      candidates.push(pathHelpers.sourceDir(parentKey) + "/main.pdf");
    } else if (role === "markdown") {
      candidates.push(pathHelpers.mdDir(parentKey) + "/paper.md");
    } else if (role === "translation") {
      const filename = pathHelpers.basename(opts.originalFilename) || "translation.pdf";
      candidates.push(pathHelpers.translationsDir(parentKey) + "/" + filename);
    } else if (role === "supplement") {
      for (let i = 1; i <= 99; i++) {
        candidates.push(pathHelpers.sourceDir(parentKey) + "/" + pathHelpers.supplementFilename(i));
      }
    }

    const existing = [];
    for (const rel of candidates) {
      if (await pathExists(rel, assetRoot, ioUtils)) existing.push(rel);
    }
    return existing;
  }

  function block(actionKey, role, reason, extra) {
    return Object.assign({
      actionKey,
      role,
      status: "blocked",
      reason,
      parentKey: null,
      originalFilename: null,
      currentPath: null,
      targetRelativePath: null,
      linkedAttachmentPath: null,
      targetFilename: null,
      title: null,
      tag: null,
      supplementNumber: null,
      assetRoot: null,
      targetExists: null
    }, extra || {});
  }

  function buildPreview(input) {
    const opts = input || {};
    const actionKey = String(opts.actionKey || "");
    const role = actionToRole(actionKey);
    const roleHelpers = roles();
    const pathHelpers = paths();

    if (!role || !roleHelpers || !pathHelpers) {
      return block(actionKey, role, "missing-preview-dependencies");
    }

    const isAttachment = !!opts.isAttachment;
    const isParent = !!opts.isParent;
    if (role === "markdown" ? !isParent : !isAttachment) {
      return block(actionKey, role, "invalid-selection-for-action", {
        parentKey: opts.parentKey || null,
        originalFilename: opts.originalFilename || null,
        currentPath: opts.currentPath || null
      });
    }

    const target = pathHelpers.targetPathForRole({
      parentKey: opts.parentKey,
      role,
      originalFilename: opts.originalFilename,
      existingRelativePaths: opts.existingRelativePaths || []
    });

    const title = roleHelpers.attachmentTitleForRole(role, opts.originalFilename, {
      supplementNumber: target.supplementNumber
    });
    const tag = roleHelpers.roleTagForRole(role);

    var result = {
      actionKey,
      role,
      status: target.status,
      reason: target.reason,
      parentKey: opts.parentKey || null,
      originalFilename: opts.originalFilename || null,
      currentPath: opts.currentPath || null,
      targetRelativePath: target.relativePath || null,
      linkedAttachmentPath: target.relativePath ? "attachments:" + target.relativePath : null,
      targetFilename: target.filename || null,
      title,
      tag,
      supplementNumber: target.supplementNumber || null,
      assetRoot: opts.assetRoot || null,
      targetExists: opts.targetExists == null ? null : !!opts.targetExists,
      skipCopy: !!opts.skipCopy,
      updateOnly: !!opts.updateOnly
    };
    if (opts._overrideStatus) {
      result.status = opts._overrideStatus;
      result.reason = opts._overrideReason || null;
    }
    return result;
  }

  function previewForSelection(actionKey, selectionInfo, zotero) {
    const sel = selectionInfo || {};
    const role = actionToRole(actionKey);
    if (!role) return block(actionKey, null, "unknown-action");
    if (sel.count !== 1 || !sel.items || sel.items.length !== 1) {
      return block(actionKey, role, "select-exactly-one-item");
    }

    const item = sel.items[0];
    const isAttachment = itemIsAttachment(item);
    const isParent = itemIsParent(item);
    const parentKey = getParentKeyForItem(item, zotero || Zotero);
    const originalFilename = role === "markdown" ? "paper.md" : getAttachmentFilename(item);
    const currentPath = getCurrentPath(item);

    return buildPreview({
      actionKey,
      parentKey,
      originalFilename,
      currentPath,
      isAttachment,
      isParent,
      isNote: itemIsNote(item),
      existingRelativePaths: sel.existingRelativePaths || []
    });
  }

  async function previewForSelectionWithPreflight(actionKey, selectionInfo, zotero, ioUtils) {
    const sel = selectionInfo || {};
    const role = actionToRole(actionKey);
    if (!role) return block(actionKey, null, "unknown-action");
    if (sel.count !== 1 || !sel.items || sel.items.length !== 1) {
      return block(actionKey, role, "select-exactly-one-item");
    }

    const z = zotero || Zotero;
    const item = sel.items[0];
    const isAttachment = itemIsAttachment(item);
    const isParent = itemIsParent(item);
    const parentKey = getParentKeyForItem(item, z);
    const originalFilename = role === "markdown" ? "paper.md" : getAttachmentFilename(item);
    const currentPath = getCurrentPath(item);
    const assetRoot = assetRootFromZotero(z);
    const existingRelativePaths = await collectExistingRelativePaths({
      actionKey,
      parentKey,
      originalFilename,
      assetRoot,
      ioUtils
    });
    const draft = buildPreview({
      actionKey,
      parentKey,
      originalFilename,
      currentPath,
      isAttachment,
      isParent,
      isNote: itemIsNote(item),
      existingRelativePaths,
      assetRoot
    });
    const targetExists = draft.targetRelativePath
      ? await pathExists(draft.targetRelativePath, assetRoot, ioUtils)
      : null;
    const sourcePath = getCurrentPath(item);
    const targetAbsPath = assetRoot && draft.targetRelativePath
      ? absolutePathForRelativePath(draft.targetRelativePath, assetRoot)
      : null;
    const sameFile = sourcePath && targetAbsPath
      && String(sourcePath).replace(/\\+/g, "/").replace(/\/+$/g, "").toLowerCase()
        === String(targetAbsPath).replace(/\\+/g, "/").replace(/\/+$/g, "").toLowerCase();
    const alreadyLinked = Zotero.ZotLink.convert
      && Zotero.ZotLink.convert.isProbablyAlreadyLinked
      && Zotero.ZotLink.convert.isProbablyAlreadyLinked(item, draft.targetRelativePath, z);
    let finalStatus = draft.status;
    let finalReason = draft.reason;
    if (alreadyLinked) {
      finalStatus = "update-only";
      finalReason = "already-linked-correct-path";
    } else if (finalStatus === "blocked" && sameFile) {
      finalStatus = "ready";
      finalReason = null;
    } else if (finalStatus === "ready" && sameFile) {
      finalStatus = "ready-skip-copy";
    }
    return buildPreview({
      actionKey,
      parentKey,
      originalFilename,
      currentPath,
      isAttachment,
      isParent,
      isNote: itemIsNote(item),
      existingRelativePaths,
      assetRoot,
      targetExists,
      skipCopy: (finalStatus === "ready-skip-copy" || finalStatus === "ready" && sameFile) || undefined,
      updateOnly: alreadyLinked || undefined,
      _overrideStatus: finalStatus,
      _overrideReason: finalReason
    });
  }

  function valueOrDash(value) {
    return value == null || value === "" ? "—" : String(value);
  }

  function formatPreviewMessage(preview, selectionInfo) {
    const p = preview || {};
    const sel = selectionInfo || {};
    const lines = [
      "zot-link: " + valueOrDash(p.actionKey),
      "",
      "DRY-RUN ONLY — preview only; no file or Zotero item will be changed.",
      "",
      "Selection:",
      "  count       = " + (sel.count != null ? sel.count : 0),
      "  attachment? = " + !!sel.hasAttachment,
      "  parent?     = " + !!sel.hasParent,
      "  note?       = " + !!sel.hasNote,
      "",
      "Preview:",
      "  status      = " + valueOrDash(p.status),
      "  reason      = " + valueOrDash(p.reason),
      "  parent key  = " + valueOrDash(p.parentKey),
      "  source      = " + valueOrDash(p.currentPath),
      "  asset root  = " + valueOrDash(p.assetRoot),
      "  original    = " + valueOrDash(p.originalFilename),
      "  target      = " + valueOrDash(p.targetRelativePath),
      "  exists?     = " + valueOrDash(p.targetExists),
      "  linked path = " + valueOrDash(p.linkedAttachmentPath),
      "  title       = " + valueOrDash(p.title),
      "  tag         = " + valueOrDash(p.tag)
    ];
    return lines.join("\n");
  }

  if (typeof Zotero !== "undefined") {
    Zotero.ZotLink = Zotero.ZotLink || {};
    Zotero.ZotLink.preview = {
      ACTION_ROLE,
      actionToRole,
      itemIsAttachment,
      itemIsParent,
      itemIsNote,
      getParentKeyForItem,
      getCurrentPath,
      getAttachmentFilename,
      assetRootFromZotero,
      absolutePathForRelativePath,
      pathExists,
      collectExistingRelativePaths,
      buildPreview,
      previewForSelection,
      previewForSelectionWithPreflight,
      formatPreviewMessage
    };
  }
})();
