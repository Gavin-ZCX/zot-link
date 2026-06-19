/* zot-link contextMenu — item tree right-click menu (dry-run skeleton).
 * Loaded by bootstrap.js AFTER src/menus.js. Exposes Zotero.ZotLink.contextMenu.
 *
 * MILESTONE: DRY-RUN ONLY. No attachment is moved/copied/deleted, no linked
 * attachment is created, no item.erase() / Zotero.Attachments API is invoked.
 * Click handlers only emit Zotero.debug + window.alert.
 */

(function () {
  "use strict";

  const ACTIONS = [
    { key: "main",        label: "zot-link: 整理为 Main PDF",         scope: "attachment" },
    { key: "translation", label: "zot-link: 整理为 Translation PDF",  scope: "attachment" },
    { key: "supplement",  label: "zot-link: 整理为 Supplement PDF",   scope: "attachment" },
    { key: "markdown",    label: "zot-link: 挂接 Markdown Full Text", scope: "parent" }
  ];

  const SEPARATOR_ID    = "zot-link-itemmenu-separator";
  const ITEM_ID_PREFIX  = "zot-link-itemmenu-action-";
  const HANDLER_STASH   = "__zotLinkContextMenuHandlers";

  // Candidate popup IDs for the item context menu (Zotero 7 / 9 DOM).
  // First match wins; misses get logged so we can adapt if Zotero 9 renames it.
  const CANDIDATE_POPUP_IDS = ["zotero-itemmenu"];

  function actionLabel(key) {
    const a = ACTIONS.find((x) => x.key === key);
    return a ? a.label : null;
  }

  function menuItemId(key) {
    return ITEM_ID_PREFIX + key;
  }

  function dryRunMessage(key, selectionInfo) {
    const label = actionLabel(key) || key;
    const sel = selectionInfo || {};
    const lines = [
      label,
      "",
      "DRY-RUN ONLY — not implemented yet.",
      "",
      "Selection:",
      "  count       = " + (sel.count != null ? sel.count : 0),
      "  attachment? = " + !!sel.hasAttachment,
      "  parent?     = " + !!sel.hasParent,
      "  note?       = " + !!sel.hasNote
    ];
    return lines.join("\n");
  }

  function computeVisibility(action, sel) {
    if (!action || !sel) return true;
    if (action.scope === "attachment") return !!sel.hasAttachment;
    if (action.scope === "parent")     return !!sel.hasParent;
    return true;
  }

  function findItemPopup(doc) {
    if (!doc || typeof doc.getElementById !== "function") return null;
    for (const id of CANDIDATE_POPUP_IDS) {
      const el = doc.getElementById(id);
      if (el) return { id, el };
    }
    return null;
  }

  function getSelectionInfo(window) {
    const info = { count: 0, hasAttachment: false, hasParent: false, hasNote: false, items: [] };
    const ZP = window && window.ZoteroPane;
    if (!ZP || typeof ZP.getSelectedItems !== "function") return info;
    let items;
    try { items = ZP.getSelectedItems(); } catch (_e) { return info; }
    if (!items || !items.length) return info;
    info.count = items.length;
    info.items = items;
    for (const it of items) {
      if (!it) continue;
      if (typeof it.isAttachment === "function" && it.isAttachment()) {
        info.hasAttachment = true;
      } else if (typeof it.isNote === "function" && it.isNote()) {
        info.hasNote = true;
      } else if (typeof it.isRegularItem === "function" && it.isRegularItem()) {
        info.hasParent = true;
      }
    }
    return info;
  }

  function addToWindow(window) {
    if (!window || !window.document) return;
    const doc = window.document;
    if (doc.getElementById(SEPARATOR_ID)) return; // already attached

    const found = findItemPopup(doc);
    if (!found) {
      Zotero.debug("[zot-link] context menu popup not found in window; tried: "
        + CANDIDATE_POPUP_IDS.join(", "));
      return;
    }
    Zotero.debug("[zot-link] context menu attaching to #" + found.id);
    const popup = found.el;

    const separator = doc.createXULElement("menuseparator");
    separator.id = SEPARATOR_ID;
    popup.appendChild(separator);

    for (const action of ACTIONS) {
      const mi = doc.createXULElement("menuitem");
      mi.id = menuItemId(action.key);
      mi.setAttribute("label", action.label);
      mi.addEventListener("command", () => {
        try {
          const sel = getSelectionInfo(window);
          Zotero.debug("[zot-link] context menu command: " + action.key
            + " (count=" + sel.count
            + ", attachment=" + sel.hasAttachment
            + ", parent=" + sel.hasParent
            + ", note=" + sel.hasNote + ")");
          if (Zotero.ZotLink.preview && typeof Zotero.ZotLink.preview.previewForSelection === "function") {
            const preview = Zotero.ZotLink.preview.previewForSelection(action.key, sel, Zotero);
            Zotero.debug("[zot-link] preview: " + action.key
              + " status=" + preview.status
              + " target=" + preview.targetRelativePath
              + " reason=" + preview.reason);
            window.alert(Zotero.ZotLink.preview.formatPreviewMessage(preview, sel));
          } else {
            window.alert(dryRunMessage(action.key, sel));
          }
        } catch (e) {
          Zotero.logError(e);
        }
      });
      popup.appendChild(mi);
    }

    // popupshowing: gate visibility by selection type.
    const handler = () => {
      try {
        const sel = getSelectionInfo(window);
        let anyVisible = false;
        for (const action of ACTIONS) {
          const mi = doc.getElementById(menuItemId(action.key));
          if (!mi) continue;
          const visible = computeVisibility(action, sel);
          mi.hidden = !visible;
          if (visible) anyVisible = true;
        }
        const sep = doc.getElementById(SEPARATOR_ID);
        if (sep) sep.hidden = !anyVisible;
      } catch (e) {
        Zotero.logError(e);
      }
    };
    popup.addEventListener("popupshowing", handler);

    if (!window[HANDLER_STASH]) window[HANDLER_STASH] = [];
    window[HANDLER_STASH].push({ popup, handler });
  }

  function removeFromWindow(window) {
    if (!window || !window.document) return;
    const doc = window.document;
    const sep = doc.getElementById(SEPARATOR_ID);
    if (sep) sep.remove();
    for (const a of ACTIONS) {
      const mi = doc.getElementById(menuItemId(a.key));
      if (mi) mi.remove();
    }
    const stash = window[HANDLER_STASH];
    if (stash && stash.length) {
      for (const { popup, handler } of stash) {
        try { popup.removeEventListener("popupshowing", handler); } catch (_e) { /* noop */ }
      }
      window[HANDLER_STASH] = undefined;
    }
  }

  // Expose into Zotero runtime (merged onto an existing ZotLink namespace).
  if (typeof Zotero !== "undefined") {
    Zotero.ZotLink = Zotero.ZotLink || {};
    Zotero.ZotLink.contextMenu = {
      ACTIONS,
      SEPARATOR_ID,
      ITEM_ID_PREFIX,
      CANDIDATE_POPUP_IDS,
      actionLabel,
      menuItemId,
      dryRunMessage,
      computeVisibility,
      findItemPopup,
      getSelectionInfo,
      addToWindow,
      removeFromWindow
    };
  }
})();
