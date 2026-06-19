/* zot-link roles — pure role/tag/title helpers.
 *
 * No Zotero item mutation, no file I/O. Safe to run in Node tests and inside
 * Zotero. Exposes Zotero.ZotLink.roles.
 */

(function () {
  "use strict";

  const ROLE_MAIN = "main";
  const ROLE_TRANSLATION = "translation";
  const ROLE_SUPPLEMENT = "supplement";
  const ROLE_MARKDOWN = "markdown";

  const ROLE_TAGS = Object.freeze({
    [ROLE_MAIN]: "role/main",
    [ROLE_TRANSLATION]: "role/translation",
    [ROLE_SUPPLEMENT]: "role/supplement"
  });

  const ROLE_ALIASES = Object.freeze({
    main: ROLE_MAIN,
    "role/main": ROLE_MAIN,
    translation: ROLE_TRANSLATION,
    translated: ROLE_TRANSLATION,
    "role/translation": ROLE_TRANSLATION,
    supplement: ROLE_SUPPLEMENT,
    supplementary: ROLE_SUPPLEMENT,
    "role/supplement": ROLE_SUPPLEMENT,
    markdown: ROLE_MARKDOWN,
    md: ROLE_MARKDOWN,
    "markdown-full-text": ROLE_MARKDOWN
  });

  function normalizeRole(value) {
    if (value == null) return null;
    const key = String(value).trim().toLowerCase();
    return ROLE_ALIASES[key] || null;
  }

  function roleTagForRole(role) {
    const normalized = normalizeRole(role);
    return ROLE_TAGS[normalized] || null;
  }

  function pad2(n) {
    return String(n).padStart(2, "0");
  }

  function attachmentTitleForRole(role, originalFilename, options) {
    const normalized = normalizeRole(role);
    const opts = options || {};
    if (normalized === ROLE_MAIN) return "Main PDF";
    if (normalized === ROLE_TRANSLATION) {
      const name = originalFilename ? String(originalFilename) : "translation.pdf";
      return "Translation PDF - " + name;
    }
    if (normalized === ROLE_SUPPLEMENT) {
      const n = opts.supplementNumber != null ? opts.supplementNumber : 1;
      return "Supplement PDF - " + pad2(n);
    }
    if (normalized === ROLE_MARKDOWN) return "Markdown Full Text";
    return null;
  }

  function extractRoleTags(tags) {
    const out = [];
    for (const tag of tags || []) {
      const role = normalizeRole(tag);
      if (role && role !== ROLE_MARKDOWN && roleTagForRole(role) === String(tag).trim().toLowerCase()) {
        out.push(role);
      }
    }
    return Array.from(new Set(out));
  }

  function resolveRole(input) {
    const opts = input || {};
    const explicit = normalizeRole(opts.explicitRole);
    if (explicit) {
      return { status: "ready", role: explicit, source: "explicit", reason: null };
    }

    const rolesFromTags = extractRoleTags(opts.tags || []);
    if (rolesFromTags.length > 1) {
      return { status: "blocked", role: null, source: "tag", reason: "conflicting-role-tags" };
    }
    if (rolesFromTags.length === 1) {
      return { status: "ready", role: rolesFromTags[0], source: "tag", reason: null };
    }

    const mode = opts.mode || "manual";
    if (mode === "batch") {
      return { status: "blocked", role: null, source: null, reason: "missing-role-in-batch" };
    }

    // Manual single-item action is an explicit user trigger; per design, no-role
    // manual/auto paths may default to main. Batch migration must not.
    return { status: "ready", role: ROLE_MAIN, source: "manual-default", reason: null };
  }

  if (typeof Zotero !== "undefined") {
    Zotero.ZotLink = Zotero.ZotLink || {};
    Zotero.ZotLink.roles = {
      ROLE_MAIN,
      ROLE_TRANSLATION,
      ROLE_SUPPLEMENT,
      ROLE_MARKDOWN,
      ROLE_TAGS,
      normalizeRole,
      roleTagForRole,
      attachmentTitleForRole,
      extractRoleTags,
      resolveRole,
      pad2
    };
  }
})();
