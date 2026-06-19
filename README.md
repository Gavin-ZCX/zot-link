# zot-link

`zot-link` 是一个面向 **Zotero 9 桌面端** 的本地插件，用于把 Zotero 的导入式附件（`imported_file` / Zotero storage 副本）整理为 OneDrive 文献库中的结构化 **linked attachments**。

它的目标不是做通用文件管理器，而是作为文献知识管理流水线中的一个很窄、可验证、可自动化的 Zotero 附件整理组件。

当前版本：`0.0.17`

---

## 一句话说明

`zot-link` 负责把 Zotero 条目下的 PDF / Markdown 附件挂接到统一目录结构：

```text
C:\OneDrive\Zotero\_items\{ITEM_KEY}\...
```

并在安全条件满足时释放 Zotero storage 中的 imported attachment 副本。

---

## 适用场景

适合用于这样的文献管理体系：

1. Zotero 负责文献条目、元数据、引用、附件索引；
2. OneDrive 文献库负责真实文件长期存储；
3. Hermes / agent 负责编排文献处理流程；
4. Obsidian / Markdown 系统负责笔记、卡片和知识组织；
5. `zot-link` 只负责 Zotero 附件从 storage 到 linked attachment 的安全转换与挂接。

---

## 能力边界

### 插件负责

- Zotero 9 桌面端插件加载；
- Zotero Tools 菜单诊断；
- Zotero 条目/附件右键菜单；
- 角色化附件整理：
  - Main PDF；
  - Translation PDF；
  - Supplement PDF；
  - Markdown Full Text；
- imported attachment → linked attachment 的安全转换；
- 已在目标目录的 imported attachment 跳过复制并直接转 linked；
- 已经是 linked attachment 的 update-only：只更新标题/标签；
- 父条目下已有 `md/paper.md` 时，将 Markdown 文件挂接为 linked attachment；
- tag 触发的 agent 自动化接口；
- 写入 `_items/{KEY}/meta/zot-link-log.jsonl` 供 agent 检查结果。

### 插件不负责

以下能力不属于 `zot-link` 的职责：

- 不做 Doc2X；
- 不做 scanscipdf；
- 不做 OCR；
- 不做 AI 笔记；
- 不生成 Obsidian 卡片；
- 不做 RAG；
- 不做主题分类；
- 不从 `_inbox` 自动创建 Zotero parent item；
- 不决定批量迁移时无角色附件应该是什么类型；
- 不作为通用文件移动/重命名工具。

如果 agent 构建完整知识管理流程，应把这些任务放在 `zot-link` 外部完成，只把最终需要 Zotero 桌面内部 API 的附件转换/挂接交给本插件。

---

## 目标目录结构

以 Zotero parent item key 为目录名：

```text
_items/{KEY}/
├── source/
│   ├── main.pdf
│   └── supplement-NN.pdf
├── translations/
│   └── {原文件名}.pdf
├── md/
│   └── paper.md
└── meta/
    └── zot-link-log.jsonl
```

角色对应关系：

| 角色 | 目标路径 | Zotero 附件标题 | 角色标签 |
|---|---|---|---|
| Main PDF | `_items/{KEY}/source/main.pdf` | `Main PDF` | `role/main` |
| Translation PDF | `_items/{KEY}/translations/{原文件名}` | `Translation PDF - {原文件名}` | `role/translation` |
| Supplement PDF | `_items/{KEY}/source/supplement-NN.pdf` | `Supplement PDF - NN` | `role/supplement` |
| Markdown Full Text | `_items/{KEY}/md/paper.md` | `Markdown Full Text` | 无 role 标签 |

注意：附件标题不使用 `01/02/03/04` 数字前缀。默认打开优先级通过 `dateAdded` 等元数据控制，而不是把排序序号写进标题。

---

## 核心安全规则

`zot-link` 的转换逻辑遵循保守安全策略：

```text
copy → verify size/hash → create linked clone
→ transfer annotations/relations/fulltext
→ verify linked attachment resolves
→ erase original imported attachment/storage
```

安全约束：

- 不简单 `move` 原文件；
- `main.pdf` 已存在且不是同一文件时不覆盖；
- 任一步失败，原 imported attachment 不删除；
- copy 失败会清理半成品目标文件；
- clone/save 失败会清理本次 copy 出来的目标文件；
- 已在目标路径的文件走 `ready-skip-copy`，跳过复制但仍创建 linked attachment；
- 已经是正确 linked path 的附件走 `update-only`，只更新标题/标签；
- 批量/自动流程中遇到无角色、多候选、不确定情况时不猜。

---

## 手动功能

### 右键附件

在 Zotero 中央条目列表中，右键附件，可见：

```text
zot-link: 整理为 Main PDF
zot-link: 整理为 Translation PDF
zot-link: 整理为 Supplement PDF
```

执行逻辑：

1. 先做 preflight；
2. 如果 blocked，只显示预览，不执行；
3. 如果 ready，弹出确认框；
4. 用户确认后执行真实转换；
5. 成功后原 imported attachment 被释放，只保留 linked attachment。

常见状态：

| 状态 | 含义 |
|---|---|
| `ready` | 可复制到目标路径并转换 |
| `ready-skip-copy` | 源文件已经在目标位置，跳过复制，直接创建 linked attachment |
| `update-only` | 已经是正确 linked attachment，只更新标题/标签 |
| `blocked` | 不安全或条件不足，不执行 |

### 右键父条目

在父条目上可见：

```text
zot-link: 挂接 Markdown Full Text
```

该操作不会生成 Markdown。它只检查：

```text
_items/{KEY}/md/paper.md
```

如果文件存在，则通过 Zotero linked attachment 挂接为：

```text
Markdown Full Text
```

如果文件不存在，返回：

```text
blocked: md-file-not-found
```

---

## Agent 自动化接口

### 触发方式

Agent 不需要直接调用插件函数。推荐通过 Zotero 标签触发：

```text
role/main
role/translation
role/supplement
```

典型外部操作：

```bash
zot tag <attachment-key> role/main
zot tag <attachment-key> role/translation
zot tag <attachment-key> role/supplement
```

插件通过 Zotero Notifier 监听 `item-tag` / `item` 事件，并自动处理。

### 自动触发行为

- imported attachment：执行完整安全转换；
- linked attachment：如果路径正确，执行 update-only，更新标题/标签；
- role 标签加在父条目上：只有当父条目下恰好一个 imported attachment 时才 fallback 到该附件；多个附件时不猜；
- 自动流程不弹确认框；
- 结果写 JSONL 日志。

### 自动化日志

日志位置：

```text
_items/{KEY}/meta/zot-link-log.jsonl
```

示例：

```json
{
  "timestamp": "2026-06-19T13:37:22.690Z",
  "action": "convert-imported-to-linked",
  "parent_key": "CVAVIG2N",
  "attachment_key_old": "OLDKEY",
  "attachment_key_new": "NEWKEY",
  "role": "main",
  "target_path": "_items/CVAVIG2N/source/main.pdf",
  "status": "success",
  "error": null
}
```

Agent 可以读取该日志判断每个附件是否处理成功。

### Tools 菜单诊断

`Tools → zot-link` 会显示当前插件和自动化状态：

```text
zot-link v0.0.17 — skeleton loaded.
Manual actions: ready.
Auto convert: running.
observerID: ...
lastEvent: ...
lastParsedIDs: ...
lastCandidates: ...
lastHandled: ...
lastError: ...
lastSkipped: ...
```

排查含义：

| 字段 | 含义 |
|---|---|
| `Auto convert` | auto 模块是否运行 |
| `observerID` | Zotero Notifier observer 是否注册成功 |
| `lastEvent` | 最近一次 Zotero 事件 |
| `lastParsedIDs` | 从 Zotero 复合事件 ID 中解析出的候选 ID |
| `lastCandidates` | 每个候选 ID 的处理/跳过原因 |
| `lastHandled` | 最近真正进入自动流程的 item |
| `lastError` | 最近错误 |
| `lastSkipped` | 最近跳过原因 |

---

## Obsidian 联动建议

`zot-link` 不直接生成 Obsidian 卡片，也不管理 Obsidian vault。

推荐联动方式：

1. agent 在 Obsidian 中生成文献卡片；
2. 卡片 YAML/frontmatter 中记录 Zotero item key；
3. agent 在 Zotero 条目下创建 URL attachment，例如：

```text
obsidian://open?vault=<vault-name>&file=<card-path>
```

这样 Zotero 中点击 URL attachment 即可打开对应 Obsidian 卡片。

是否创建该 URL attachment，应该由 agent/知识管理流程决定，而不是 `zot-link` 自动决定。

---

## 安装与验证

### 构建

```bash
npm run check
npm run build
```

产物：

```text
dist/zot-link-<version>.xpi
```

### 安装

在 Zotero 中：

```text
Tools → Plugins → 齿轮图标 → Install Plugin From File…
```

选择：

```text
dist/zot-link-0.0.17.xpi
```

建议每次安装新版后重启 Zotero。

### 基本验证

1. 点击 `Tools → zot-link`；
2. 应显示版本号、手动功能状态、自动功能状态；
3. 右键一个 imported PDF 附件，选择 `整理为 Main PDF`；
4. preflight 显示 target、title、tag；
5. 确认后检查 linked attachment 是否可打开；
6. 检查 `_items/{KEY}/meta/zot-link-log.jsonl`。

---

## 开发与测试

### 项目结构

```text
bootstrap.js              Zotero 插件生命周期
manifest.json             Zotero 9 manifest
src/roles.js              角色、标签、附件标题纯函数
src/paths.js              _items/{KEY} 路径计算
src/preview.js            dry-run / preflight 预览
src/convert.js            安全转换与 linkExistingFile
src/autoConvert.js        tag 触发自动化接口
src/menus.js              Tools 菜单与窗口生命周期
src/contextMenu.js        Zotero 右键菜单
tests/*.mjs               Node 纯函数 / 转换流程测试
scripts/build.mjs         XPI 打包脚本
```

### 测试

```bash
npm run check
```

当前覆盖：

- context menu 基础行为；
- role/title/tag 规则；
- `_items/{KEY}` 路径规则；
- dry-run preview；
- imported → linked 转换安全路径；
- target exists / copy fail / clone fail 保护路径。

---

## Manifest 兼容性说明

Zotero 9 本地开发使用：

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

注意：

- `applications.zotero.update_url` 在 Zotero 9 中必须存在；
- 当前 `update_url` 是本地开发占位 URL，正式发布前应替换；
- 插件 ID 使用域名式 `@local.invalid`，避免 Add-on Manager 拒绝非域名式 ID；
- 当前实现目标是 Zotero 9，不承诺 Zotero 6/7/8 完整兼容。

---

## License / NOTICE

License: `GPL-3.0-only`

本项目没有直接 fork ZotMoov，也没有复制 ZotMoov 源码。设计上借鉴了 ZotMoov 的核心转换思路：

```text
clone → LINK_MODE_LINKED_FILE → save → transfer child items/relations/fulltext → erase original
```

详见：

- [LICENSE](./LICENSE)
- [NOTICE](./NOTICE)

---

## 给 agent 的集成摘要

如果你是自动化 agent，需要记住：

1. `zot-link` 只处理 Zotero 附件，不生成笔记、不做 OCR、不做 Obsidian 卡片；
2. Main / translation / supplement 用 role 标签触发；
3. Markdown 必须先由外部流程生成 `_items/{KEY}/md/paper.md`，插件只负责挂接；
4. 无 role 的批量迁移不要默认正文；
5. 多 PDF 条目必须先由外部流程或用户确定角色；
6. 转换结果看 `_items/{KEY}/meta/zot-link-log.jsonl`；
7. 不要直接移动 Zotero storage 文件；让插件通过 Zotero 内部 API 完成转换。
