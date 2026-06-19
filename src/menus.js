/* zot-link menus — Tools menu entry + item-tree context menu wiring.
 * Loaded by bootstrap.js via Services.scriptloader. The context menu logic
 * itself lives in src/contextMenu.js and is exposed as Zotero.ZotLink.contextMenu;
 * this file only delegates lifecycle calls to it.
 */

Zotero.ZotLink = Zotero.ZotLink || {};
Object.assign(Zotero.ZotLink, {
  id: null,
  version: null,
  rootURI: null,
  initialized: false,
  attachedWindows: new WeakSet(),

  TOOLS_MENUITEM_ID: "zot-link-tools-menuitem",

  init({ id, version, rootURI }) {
    this.id = id;
    this.version = version;
    this.rootURI = rootURI;
    this.initialized = true;
    Zotero.debug("[zot-link] ZotLink.init version=" + version);
  },

  uninit() {
    this.initialized = false;
    Zotero.debug("[zot-link] ZotLink.uninit");
  },

  addToWindow(window) {
    if (!window || !window.document) return;
    const doc = window.document;

    // 1) Tools menu (existing behaviour).
    if (!doc.getElementById(this.TOOLS_MENUITEM_ID)) {
      const toolsPopup = doc.getElementById("menu_ToolsPopup");
      if (!toolsPopup) {
        Zotero.debug("[zot-link] menu_ToolsPopup not found in this window — skipping tools entry");
      } else {
        const menuitem = doc.createXULElement("menuitem");
        menuitem.id = this.TOOLS_MENUITEM_ID;
        menuitem.setAttribute("label", "zot-link");
        menuitem.addEventListener("command", () => {
          try {
            const msg = "zot-link v" + this.version + " — skeleton loaded.\n"
              + "MVP actions (right-click conversion, batch preview) not yet implemented.";
            window.alert(msg);
            Zotero.debug("[zot-link] tools menu clicked");
          } catch (e) {
            Zotero.logError(e);
          }
        });
        toolsPopup.appendChild(menuitem);
        Zotero.debug("[zot-link] tools menuitem attached to window");
      }
    }

    // 2) Item-tree context menu (delegated to contextMenu.js).
    if (this.contextMenu && typeof this.contextMenu.addToWindow === "function") {
      try { this.contextMenu.addToWindow(window); }
      catch (e) { Zotero.logError(e); }
    } else {
      Zotero.debug("[zot-link] contextMenu module missing — skipping right-click menu");
    }

    this.attachedWindows.add(window);
  },

  removeFromWindow(window) {
    if (!window || !window.document) return;
    const doc = window.document;
    const tools = doc.getElementById(this.TOOLS_MENUITEM_ID);
    if (tools) tools.remove();
    if (this.contextMenu && typeof this.contextMenu.removeFromWindow === "function") {
      try { this.contextMenu.removeFromWindow(window); }
      catch (e) { Zotero.logError(e); }
    }
    this.attachedWindows.delete(window);
  },

  windowListener: {
    onOpenWindow(xulWindow) {
      const domWindow = xulWindow.docShell.domWindow;
      domWindow.addEventListener(
        "load",
        () => {
          if (
            domWindow.document.documentElement.getAttribute("windowtype")
              === "navigator:browser"
          ) {
            Zotero.ZotLink.addToWindow(domWindow);
          }
        },
        { once: true }
      );
    },
    onCloseWindow() {},
    onWindowTitleChange() {}
  }
});
