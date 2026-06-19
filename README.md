# zot-link

`zot-link` is a Zotero 9 desktop plugin for converting Zotero imported-file attachments into structured linked attachments under an `_items/{ITEM_KEY}/` directory.

It is designed for users who keep a Zotero library together with a file-based paper archive, and who want Zotero attachments to point to predictable, portable files instead of keeping duplicate PDFs inside Zotero `storage/`.

Current version: `0.0.17`

> Status: early but usable local-development release. The manual conversion flow and tag-triggered automation flow have been tested in a local Zotero 9 setup. Use a test profile or a backed-up library before running it on an important library.

---

## What it does

`zot-link` organizes attachments for a Zotero parent item into a fixed directory layout:

```text
_items/{ITEM_KEY}/
├── source/
│   ├── main.pdf
│   └── supplement-NN.pdf
├── translations/
│   └── {original-filename}.pdf
├── md/
│   └── paper.md
└── meta/
    └── zot-link-log.jsonl
```

It supports four attachment roles:

| Role | Target path | Zotero attachment title | Tag |
|---|---|---|---|
| Main PDF | `_items/{KEY}/source/main.pdf` | `Main PDF` | `role/main` |
| Translation PDF | `_items/{KEY}/translations/{original-filename}` | `Translation PDF - {original-filename}` | `role/translation` |
| Supplement PDF | `_items/{KEY}/source/supplement-NN.pdf` | `Supplement PDF - NN` | `role/supplement` |
| Markdown full text | `_items/{KEY}/md/paper.md` | `Markdown Full Text` | none |

The `_items` directory is resolved relative to Zotero's **Linked Attachment Base Directory**.

---

## What it does not do

`zot-link` intentionally has a narrow scope. It does not:

- create Zotero parent items from an inbox folder;
- decide automatically which of several PDFs is the main paper;
- run OCR;
- run Doc2X or other document converters;
- generate AI notes;
- create Obsidian notes;
- manage an Obsidian vault;
- perform RAG indexing;
- classify papers by topic;
- provide a general-purpose file renaming or file moving system.

Those tasks can be handled by other tools. `zot-link` focuses only on Zotero attachment conversion and linking, where Zotero desktop APIs are required.

---

## Safety model

A normal imported-file conversion follows this sequence:

```text
copy source file
→ verify size/hash
→ create linked Zotero attachment clone
→ transfer annotations, notes, relations, and full-text index
→ verify the linked attachment resolves
→ erase the original imported attachment
```

Safety rules:

- It does not simply move files.
- It does not overwrite an existing `main.pdf` or other conflicting target.
- If any step fails, the original imported attachment is left untouched.
- If a copied target file is produced by a failed conversion, the plugin attempts to clean it up.
- If the source file is already in the target location, the plugin uses a `ready-skip-copy` path and skips the copy step.
- If the attachment is already a linked attachment with the correct path, the plugin uses `update-only` and only normalizes title/tag metadata.
- Batch or automated flows do not guess when the role is ambiguous.

---

## Manual usage

### Convert a PDF attachment

Right-click a Zotero attachment in the central item tree and choose one of:

```text
zot-link: 整理为 Main PDF
zot-link: 整理为 Translation PDF
zot-link: 整理为 Supplement PDF
```

The plugin first shows a preflight preview. If the operation is safe, it asks for confirmation before making changes.

Common preflight states:

| State | Meaning |
|---|---|
| `ready` | Target does not exist; the file can be copied and converted. |
| `ready-skip-copy` | The file is already at the target path; conversion can skip copying. |
| `update-only` | The attachment is already linked correctly; only title/tag metadata is updated. |
| `blocked` | The operation is unsafe or missing required information. Nothing is changed. |

### Link Markdown full text

Right-click a Zotero parent item and choose:

```text
zot-link: 挂接 Markdown Full Text
```

The plugin checks for:

```text
_items/{KEY}/md/paper.md
```

If the file exists, it creates a linked attachment titled:

```text
Markdown Full Text
```

If the file does not exist, it returns:

```text
blocked: md-file-not-found
```

`zot-link` does not generate `paper.md`; it only links it if another workflow has already created it.

---

## Automation via tags

`zot-link` can be triggered by adding role tags to Zotero attachments:

```text
role/main
role/translation
role/supplement
```

This is useful for scripts or external automation tools that can tag Zotero items.

Behavior:

- An imported-file attachment with a role tag is converted automatically.
- A linked-file attachment with a role tag may be normalized via `update-only` if it already points to the expected path.
- If a role tag is added to a parent item, the plugin only falls back to a child attachment when there is exactly one imported attachment below that parent. If there are zero or multiple candidates, it does not guess.
- Automated conversion does not show a confirmation dialog.
- Results are written to JSONL logs.

Log file:

```text
_items/{KEY}/meta/zot-link-log.jsonl
```

Example entry:

```json
{
  "timestamp": "2026-06-19T13:37:22.690Z",
  "action": "convert-imported-to-linked",
  "parent_key": "ABCD1234",
  "attachment_key_old": "OLDKEY",
  "attachment_key_new": "NEWKEY",
  "role": "main",
  "target_path": "_items/ABCD1234/source/main.pdf",
  "status": "success",
  "error": null
}
```

---

## Tools menu diagnostics

The plugin adds a `Tools → zot-link` entry. It displays current status and recent automation diagnostics, including:

- plugin version;
- whether manual actions are available;
- whether automatic conversion is running;
- the Zotero Notifier observer ID;
- the most recent Notifier event;
- parsed candidate item IDs;
- per-candidate handling/skipping information;
- the last handled item;
- the last error.

This is intended to make local troubleshooting possible without relying only on Zotero's Error Console.

---

## Installation

Download the `.xpi` from the repository release page, then in Zotero:

```text
Tools → Plugins → gear icon → Install Plugin From File…
```

Select:

```text
zot-link-<version>.xpi
```

Restart Zotero after installation.

Recommended Zotero setting:

```text
Settings → Advanced → Files and Folders → Linked Attachment Base Directory
```

Set this to the directory that contains `_items/`.

---

## Building from source

Requirements:

- Node.js
- npm
- Zotero 9 for runtime testing

Build and test:

```bash
npm run check
npm run build
```

The packaged plugin is written to:

```text
dist/zot-link-<version>.xpi
```

The build script creates a standard XPI/ZIP archive with `manifest.json` at the archive root.

---

## Development layout

```text
bootstrap.js              Zotero plugin lifecycle
manifest.json             Zotero 9 manifest
src/roles.js              role, tag, and attachment-title helpers
src/paths.js              _items/{KEY} path planning
src/preview.js            dry-run and preflight logic
src/convert.js            safe conversion and Markdown linkFromFile logic
src/autoConvert.js        tag-triggered automation
src/menus.js              Tools menu integration
src/contextMenu.js        Zotero item-tree context menu
tests/*.mjs               Node tests
scripts/build.mjs         XPI packaging script
```

---

## Test coverage

`npm run check` currently runs syntax checks and Node tests for:

- context menu behavior;
- role/tag/title rules;
- `_items/{KEY}` path planning;
- preflight preview states;
- imported-to-linked conversion logic;
- failure cases such as existing targets, copy failure, and clone failure.

Runtime behavior still depends on Zotero desktop APIs, so destructive behavior should be tested in a disposable Zotero profile before using it on an important library.

---

## Zotero compatibility notes

The manifest currently targets Zotero 9:

```json
{
  "applications": {
    "zotero": {
      "id": "zot-link@local.invalid",
      "update_url": "https://example.com/zot-link/updates.json",
      "strict_min_version": "6.999",
      "strict_max_version": "9.*"
    }
  }
}
```

Notes:

- Zotero 9 requires `applications.zotero.update_url` to be present in the manifest.
- The current `update_url` is a placeholder for local/development distribution.
- The plugin ID uses a domain-style local ID: `zot-link@local.invalid`.
- Zotero 6/7/8 compatibility is not guaranteed.

---

## Obsidian and note-taking workflows

`zot-link` does not create Obsidian notes. A compatible workflow can still link Zotero and Obsidian by using Zotero URL attachments such as:

```text
obsidian://open?vault=<vault-name>&file=<card-path>
```

That URL attachment should be created by the user's note-taking or automation workflow, not by `zot-link` itself.

---

## License and provenance

License: `GPL-3.0-only`

The project is not a fork of ZotMoov and does not contain copied ZotMoov source code. It does, however, follow the same general idea of safely replacing imported Zotero attachments with linked-file attachments through Zotero desktop APIs.

See:

- [LICENSE](./LICENSE)
- [NOTICE](./NOTICE)
