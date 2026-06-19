/* zot-link menus — Tools menu entry (skeleton milestone). */
/* Loaded by bootstrap.js via Services.scriptloader. */

Zotero.ZotLink = {
  id: null,
  version: null,
  rootURI: null,
  initialized: false,
  attachedWindows: new WeakSet(),

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
    if (this.attachedWindows.has(window)) return;
    const doc = window.document;
    if (doc.getElementById("zot-link-tools-menuitem")) return;

    const toolsPopup = doc.getElementById("menu_ToolsPopup");
    if (!toolsPopup) {
      Zotero.debug("[zot-link] menu_ToolsPopup not found in this window — skipping");
      return;
    }

    const menuitem = doc.createXULElement("menuitem");
    menuitem.id = "zot-link-tools-menuitem";
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
    this.attachedWindows.add(window);
    Zotero.debug("[zot-link] menuitem attached to window");
  },

  removeFromWindow(window) {
    if (!window || !window.document) return;
    const doc = window.document;
    const item = doc.getElementById("zot-link-tools-menuitem");
    if (item) item.remove();
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
};
