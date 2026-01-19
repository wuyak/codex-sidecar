# 任务清单: UI 主题与提示音整体重做（Manifest 驱动）

目录: `helloagents/history/2026-01/202601190919_ui_theme_sound_overhaul/`

---

## 1. 配置与后端 API（提示音）
- [√] 1.1 在 `codex_sidecar/config.py` 中将 `notify_sound` 破坏性替换为 `notify_sound_assistant` / `notify_sound_tool_gate`，并实现 id 校验（`none` / `builtin:*` / `file:*`），验证 why.md#需求-配置提示音（回答输出--终端确认）
- [√] 1.2 在 `config/sidecar/config.example.json` 中同步更新示例字段，验证 why.md#需求-配置提示音（回答输出--终端确认）
- [√] 1.3 新增后端音效模块（建议 `codex_sidecar/http/sfx.py`），实现：
  - 读取 `ui/sfx/manifest.json`（内置音效）
  - 扫描 `${config_home}/sounds/`（自定义音效）
  - 合并并返回给 UI（`GET /api/sfx`）
  验证 why.md#需求-自定义音效（配置目录扫描）
- [√] 1.4 在 `codex_sidecar/http/handler.py` 中新增路由 `GET /api/sfx` 与 `GET /api/sfx/file/<name>`（受限读取），验证 why.md#需求-自定义音效（配置目录扫描）

## 2. UI（提示音设置与播放）
- [√] 2.1 在 `ui/index.html` 与 `ui/app/dom.js` 中将“提示音”改为两项：回答输出音效 / 终端确认音效，并为控件补齐语义文案，验证 why.md#需求-配置提示音（回答输出--终端确认）
- [√] 2.2 在 `ui/app/control/load.js` 中请求并渲染 `/api/sfx` 返回的音效列表（动态下拉），验证 why.md#需求-配置提示音（回答输出--终端确认）
- [√] 2.3 在 `ui/app/control/wire.js` 中实现两项下拉的保存与预览（就地 toast + 预览播放），验证 why.md#需求-选择并预览内置音效
- [√] 2.4 在 `ui/app/events/stream.js` 中将事件播放拆分为“回答输出/终端确认等待”两类，验证 why.md#需求-配置提示音（回答输出--终端确认）
- [√] 2.5 在 `ui/app/sound.js` 中重做播放逻辑（按 id 解析 builtin/file），保留浏览器阻止播放的就地提示与节流，验证 why.md#需求-选择并预览内置音效

## 3. UI（主题系统重做）
- [√] 3.1 新增 `ui/themes/manifest.json`（3–4 个精选主题 tokens）与 `ui/app/theme.js`（加载/应用/本机记忆），验证 why.md#需求-选择精选主题
- [√] 3.2 在 `ui/index.html`/`ui/app/dom.js`/`ui/app/main.js` 中接入主题选择（动态渲染下拉），并移除旧 `skin` 入口，验证 why.md#场景-切换主题
- [√] 3.3 在 `ui/styles.css` 中将关键样式抽象为 tokens（圆角/阴影/间距/字体等），移除旧 skin 大块覆盖并保持 `safe-area`/`z-index` 量表一致，验证 why.md#场景-切换主题

## 4. 资源与许可
- [√] 4.1 新增 `ui/sfx/manifest.json` 与内置音效文件（约 6–10 个，来自 Kenney + ObsydianX，按许可要求记录来源），并更新 `ui/sfx/SOURCES.md`/`ui/sfx/LICENSE.txt`，验证 why.md#需求-配置提示音（回答输出--终端确认）
- [√] 4.2 清理旧音效资源目录与旧引用（如 `ui/music/*`、旧 option 列表），验证 why.md#变更内容

## 5. 安全检查
- [√] 5.1 执行安全检查（按G9）：自定义音效文件名校验、路径穿越防护、扩展名/大小限制、错误信息不泄露敏感路径

## 6. 文档更新
- [√] 6.1 更新 `helloagents/wiki/modules/rollout_sidecar.md`（主题/提示音新体系、自定义音效目录说明、破坏性变更提示）
- [√] 6.2 更新 `helloagents/CHANGELOG.md`（Unreleased 记录本次整体重做）

## 7. 测试
- [√] 7.1 新增单元测试（建议 `tests/test_sfx_security.py`）：覆盖文件名校验、路径 resolve 校验、扩展名过滤与大小限制
