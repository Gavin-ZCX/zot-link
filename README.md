# zot-link

A Zotero 9/10 plugin for turning Zotero's internal imported-file attachments into clean, predictable linked-file attachments.

`zot-link` is for people who want Zotero to manage citation metadata while keeping the actual paper files in a normal folder structure that can be backed up, inspected, synced, and used by other tools.

Instead of leaving PDFs hidden in Zotero `storage/`, `zot-link` organizes them under an `_items/{ITEM_KEY}/` directory and updates Zotero to point at those linked files.

> Status: early but usable. Manual conversion and tag-triggered automation have been tested in a local Zotero 9 setup. Before using it on an important library, test it with a disposable profile or a fully backed-up Zotero library.

---

## Why use it?

Zotero's imported attachments are convenient, but they live inside Zotero's managed `storage/` directory. That can make it harder to:

- keep paper files in a predictable archive layout;
- share attachment paths with scripts or external workflows;
- store main PDFs, translations, supplements, and Markdown text together;
- use Zotero as part of a larger file-based research system.

`zot-link` keeps Zotero in charge of the library record, annotations, notes, relations, and full-text index, while moving the file itself into a stable linked-attachment layout.

---

## What it organizes

For each Zotero parent item, `zot-link` uses this structure relative to Zotero's **Linked Attachment Base Directory**:

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

Supported attachment roles:

| Role | Target path | Zotero title | Tag |
|---|---|---|---|
| Main PDF | `_items/{KEY}/source/main.pdf` | `Main PDF` | `role/main` |
| Translation PDF | `_items/{KEY}/translations/{original-filename}` | `Translation PDF - {original-filename}` | `role/translation` |
| Supplement PDF | `_items/{KEY}/source/supplement-NN.pdf` | `Supplement PDF - NN` | `role/supplement` |
| Markdown full text | `_items/{KEY}/md/paper.md` | `Markdown Full Text` | none |

---

## Key features

- **Convert imported PDFs into linked Zotero attachments** while preserving Zotero-side metadata.
- **Role-based organization** for main papers, translations, supplements, and Markdown full text.
- **Manual right-click actions** with a preflight preview before changes are made.
- **Tag-triggered automation** for workflows that can add `role/*` tags to Zotero items.
- **Safe conversion sequence**: copy, verify, clone, link, transfer metadata, then remove the original imported attachment only after success.
- **No silent overwrites** of existing target files.
- **Visible diagnostics** from Zotero's Tools menu, so troubleshooting does not depend only on the Error Console.
- **JSONL operation logs** under `_items/{KEY}/meta/zot-link-log.jsonl`.

---

## What it does not do

`zot-link` is intentionally narrow. It does not:

- import papers from an inbox folder;
- decide which PDF is the main paper;
- run OCR or document conversion;
- generate AI notes;
- create or manage Obsidian notes;
- perform RAG indexing;
- classify papers by topic;
- act as a general file renaming or moving tool.

Those jobs can be handled by other tools. `zot-link` focuses on the part that requires Zotero desktop APIs: converting and maintaining Zotero attachments safely.

---

## Safety model

A normal conversion uses this sequence:

```text
copy source file
→ verify size/hash
→ create linked Zotero attachment clone
→ transfer annotations, notes, relations, and full-text index
→ verify the linked attachment resolves
→ erase the original imported attachment
```

Important safeguards:

- The original imported attachment is kept if any step fails.
- Existing target files are not overwritten.
- Failed conversions attempt to clean up any partially copied target file.
- If the source file is already at the target path, the plugin can skip copying and only convert the Zotero attachment.
- If an attachment is already linked correctly, the plugin only normalizes metadata such as title and role tag.
- Automated flows do not guess when the role or target is ambiguous.

---

## Installation

1. Download the `.xpi` file from the repository's release page, or build it from source.
2. In Zotero, open:

   ```text
   Tools → Plugins → gear icon → Install Plugin From File…
   ```

3. Select:

   ```text
   zot-link-<version>.xpi
   ```

4. Restart Zotero.
5. Set Zotero's linked attachment base directory:

   ```text
   Settings → Advanced → Files and Folders → Linked Attachment Base Directory
   ```

   Choose the folder that should contain `_items/`.

Compatibility: this project currently targets Zotero 9 and Zotero 10. Zotero 6/7/8 compatibility is not guaranteed.

---

## Manual usage

### Convert a PDF attachment

Right-click a Zotero attachment in the central item list and choose one of:

```text
zot-link: 整理为 Main PDF
zot-link: 整理为 Translation PDF
zot-link: 整理为 Supplement PDF
```

The plugin shows a preflight preview first. If the operation is safe, it asks for confirmation before changing files or Zotero items.

Common preflight results:

| State | Meaning |
|---|---|
| `ready` | The target does not exist; the file can be copied and converted. |
| `ready-skip-copy` | The file is already at the target path; copying can be skipped. |
| `update-only` | The attachment is already linked correctly; only title/tag metadata will be updated. |
| `blocked` | The operation is unsafe or missing required information. Nothing is changed. |

### Link Markdown full text

Right-click a Zotero parent item and choose:

```text
zot-link: 挂接 Markdown Full Text
```

`zot-link` checks for:

```text
_items/{KEY}/md/paper.md
```

If the file exists, Zotero gets a linked attachment titled `Markdown Full Text`. If it does not exist, the operation is blocked with `md-file-not-found`.

`zot-link` does not generate `paper.md`; it only links an existing Markdown file created by another workflow.

---

## Automation with tags

`zot-link` can also react to role tags:

```text
role/main
role/translation
role/supplement
```

This is useful for scripts, command-line tools, or AI-assisted research workflows that can tag Zotero attachments.

Automation behavior:

- An imported-file attachment with a role tag is converted automatically.
- A linked-file attachment with the expected path can be normalized with `update-only`.
- If a role tag is added to a parent item, the plugin only falls back to a child attachment when there is exactly one imported attachment under that parent.
- Automated conversion does not show a confirmation dialog.
- Results are written to `_items/{KEY}/meta/zot-link-log.jsonl`.

---

## Automation with local action queue

For local agent workflows, `zot-link` also watches a JSON action queue under the linked attachment base directory:

```text
_agent/queues/zot-link-actions/pending/*.json
_agent/queues/zot-link-actions/done/*.json
_agent/queues/zot-link-actions/failed/*.json
```

This avoids the slow path of `zot tag → Zotero Web API → Zotero Desktop sync → plugin notifier`. The plugin reads pending actions directly inside Zotero Desktop, executes Zotero APIs, then writes a result file to `done/` or `failed/` and removes the pending action.

Supported actions in this version:

### Attach Markdown Full Text

```json
{
  "action_id": "attach-md-4JPF79RE",
  "action": "attach-markdown",
  "parent_key": "4JPF79RE",
  "target_relative_path": "_items/4JPF79RE/md/paper.md"
}
```

If `target_relative_path` is omitted, it defaults to:

```text
_items/{parent_key}/md/paper.md
```

The plugin calls `Zotero.Attachments.linkFromFile()` and creates a linked attachment titled `Markdown Full Text`.

### Normalize already linked Main PDF

```json
{
  "action_id": "main-update-6Y5L6VLD",
  "action": "main-update-only",
  "parent_key": "6Y5L6VLD",
  "attachment_key": "SLSQTL3X",
  "target_relative_path": "_items/6Y5L6VLD/source/main.pdf"
}
```

If `target_relative_path` is omitted, it defaults to:

```text
_items/{parent_key}/source/main.pdf
```

This action does not copy, clone, or erase. It only normalizes the selected linked attachment to title `Main PDF` and tag `role/main` through the existing update-only conversion path.

Queue worker status is visible from `Tools → zot-link`.

---

## Diagnostics

The plugin adds a `Tools → zot-link` entry in Zotero. It shows status and recent automation diagnostics, including:

- plugin version;
- whether automatic conversion is running;
- the Zotero Notifier observer ID;
- the most recent Notifier event;
- parsed candidate item IDs;
- per-candidate handling or skipping information;
- the last handled item;
- the last error;
- whether the local queue worker is running;
- the last queue run, result list, and queue error.

Use this menu first when checking whether the plugin is loaded and whether tag-triggered automation is working.

---

## Build from source

Requirements:

- Node.js
- npm
- Zotero 9 for runtime testing

Run checks and build the XPI:

```bash
npm run check
npm run build
```

The packaged plugin is written to:

```text
dist/zot-link-<version>.xpi
```

### Automation & Releases

Releases are automated via GitHub Actions:
- Any push to `main` runs syntax checks and the full test suite automatically.
- Pushing a version tag (e.g. `v0.0.27`) triggers the release pipeline, builds the `.xpi`, and publishes it directly to GitHub Releases.

---

## Development notes

This repository includes Node-based tests for the pure logic around roles, path planning, preflight states, conversion behavior, and failure cases.

Runtime behavior still depends on Zotero desktop APIs. Test destructive behavior only in a disposable Zotero profile or against a backed-up library.

The manifest targets Zotero 9 and 10 with a local development extension ID:

```json
{
  "applications": {
    "zotero": {
      "id": "zot-link@local.invalid",
      "strict_min_version": "6.999",
      "strict_max_version": "10.*"
    }
  }
}
```

---

## License and provenance

License: `GPL-3.0-only`

`zot-link` is not a fork of ZotMoov and does not contain copied ZotMoov source code. It follows the same general pattern of safely replacing imported Zotero attachments with linked-file attachments through Zotero desktop APIs.

See:

- [LICENSE](./LICENSE)
- [NOTICE](./NOTICE)
