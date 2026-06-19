# zot-link

Zotero 9 桌面端插件骨架。最终目标：把 Zotero **导入式附件**（`linkMode = imported_file`）
转换为 `_items/{ITEM_KEY}/` 下的**结构化 linked attachment**，按角色（正文 / 译文 / 补充）
路由，并释放 Zotero storage 副本。

> 当前状态：**第一里程碑**仅完成最小可加载骨架——工具菜单出现 `zot-link` 入口、
> 点击弹出占位 alert。**尚未**实现任何附件转换、删除或迁移逻辑。

## 设计文档

- `C:/OneDrive/Zotero/_agent/zot-link_设计与ZotMoov分析_2026-06-16.md`
- `C:/OneDrive/Zotero/_agent/zot-link_插件实现计划_2026-06-19.md`

## 骨架方案

本仓库采用**干净的最小 bootstrapped 插件骨架**：`manifest.json` + `bootstrap.js`
与少量 `src/` 模块，并用无外部依赖的 Node 脚本打包为 `.xpi`。

选择理由：

- 兼容 Zotero 9，同时保持 Zotero 7+ bootstrapped 生命周期；
- 不 fork ZotMoov，不继承其通配符/配置架构；
- 先验证 Zotero 可加载与菜单注入，再逐步加入路径、角色、转换核心；
- `zotero-plugin-scaffold` 已确认存在，但首个里程碑使用更小骨架，避免过早引入与本项目边界无关的模板复杂度。

## 目录结构

```
zot-link/
├── manifest.json          WebExtension manifest（Zotero 9 兼容）
├── bootstrap.js           插件生命周期（startup/shutdown/install/uninstall）
├── src/
│   ├── roles.js           角色、标签、附件标题纯函数
│   ├── paths.js           `_items/{KEY}` 目标路径纯函数
│   ├── preview.js         右键动作 dry-run 预览纯函数
│   ├── menus.js           工具菜单注册（Zotero.ZotLink）
│   └── contextMenu.js     右键菜单 dry-run 骨架
├── tests/                 Node 纯函数测试
├── scripts/
│   └── build.mjs          打包为 dist/zot-link-<version>.xpi（无外部依赖）
├── package.json           build / clean npm scripts
├── README.md              本文
├── LICENSE                GPL-3.0
└── NOTICE                 第三方代码与衍生说明
```

## 构建 xpi

```bash
npm run build
```

产出：`dist/zot-link-<version>.xpi`。该文件是一个标准 zip，根目录含 `manifest.json`。

当前兼容声明使用 `strict_min_version: "6.999"`、`strict_max_version: "9.*"`，与 Zotero 9
插件兼容范围一致；插件 ID 使用 `zot-link@local.invalid`，避免 `@local` 这类非域名式 ID 被
Add-on Manager 拒绝。`update_url` 是 Zotero 9 插件 manifest 的必填字段；当前为占位 HTTPS URL，
正式发布前应替换为真实 updates.json。

## 安装到 Zotero 9 进行本地验证

> ⚠️ **不要装到日常使用的 profile**。建议先用临时 / 测试 profile。

1. 关闭 Zotero。
2. 启动 Zotero 并切换到测试 profile：
   ```
   "C:\Program Files\Zotero\zotero.exe" -P
   ```
   选择 `Create Profile…`，命名 `zot-link-dev`，**自定义** profile 目录到一个空文件夹。
   注意：Zotero 的 Firefox profile 与 Zotero data directory 是两回事；测试 profile 中也要确认
   `Advanced → Files and Folders → Data Directory Location` 指向测试目录，避免误打开日常库。
3. 启用开发模式（可选但推荐）：在 `about:config` 中查找
   `extensions.experiments.enabled` 并设为 `true`；同时打开
   `Tools → Developer → Error Console` 查看 `[zot-link]` 日志。
4. 安装 xpi：`Tools → Plugins → 齿轮图标 → Install Plugin From File…`，
   选择 `dist/zot-link-<version>.xpi`。如果 Zotero 已安装旧版，建议先在插件管理器里移除旧版再安装新版。
5. 验证：
   - 重启 Zotero。
   - `Tools` 菜单底部应出现 `zot-link`。
   - 点击应弹出 "zot-link v0.0.7 — skeleton loaded." 的 alert。
   - `Error Console` 中应看到 `[zot-link] startup version=0.0.7` 与
     `[zot-link] menuitem attached to window`。

## 当前实现状态

- Tools 菜单与 Zotero 条目列表右键菜单已可加载。
- 右键菜单：`ready` 项会弹出确认对话框，确认后执行真实转换（copy→verify→clone→linked→erase original）；`blocked` 项仍只预览。
- `src/roles.js` / `src/paths.js` / `src/preview.js` 已固化角色、标题、`_items/{KEY}` 路径与 dry-run 预览规则，并由 Node 测试覆盖。

## 开发热加载（可选）

将 `dist/zot-link-<version>.xpi` 解压后路径填入 Zotero profile
`extensions/zot-link@local` 文件（包含解压目录的绝对路径），重启 Zotero
即可直接加载源码目录。修改 `src/` 后只需重启或 `Tools → Developer →
Restart with logging`。

## License

GPL-3.0-only — 见 [LICENSE](./LICENSE)。

当前骨架**尚未**复制或衍生 [ZotMoov](https://github.com/wileyyugioh/zotmoov)
代码；后续若移植其转换机制（§4.3 of design doc），将继续保留 GPL-3.0 并在
[NOTICE](./NOTICE) 中标注衍生来源。
