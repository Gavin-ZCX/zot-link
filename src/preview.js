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
      supplementNumber: null
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

    return {
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
      supplementNumber: target.supplementNumber || null
    };
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
      "  original    = " + valueOrDash(p.originalFilename),
      "  target      = " + valueOrDash(p.targetRelativePath),
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
      buildPreview,
      previewForSelection,
      formatPreviewMessage
    };
  }
})();
