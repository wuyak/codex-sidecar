# 技术设计: 仓库彻底扁平化（Phase 2）

## 技术方案
### 核心技术
- 目录迁移（`mv`）+ 路径引用更新（Python/脚本/文档）
- 静态资源目录重定位（服务端 `ui_assets.py` 读取新的 `ui/`、`ui_legacy/`）
- 配置落点调整：默认 `./config/sidecar/`，并做一次性迁移导入

### 实现要点
1. **后端迁移**
   - 将 `tools/codex_thinking_sidecar/codex_thinking_sidecar/` 迁移为顶层 `codex_sidecar/`。
   - 模块内部 import 以相对导入为主，迁移后仍可工作；需要更新：
     - CLI `prog`/描述中的名称（展示层）
     - HTTP `server_version`（展示层）
2. **UI 迁移**
   - 将默认 UI：`tools/.../ui/` → `./ui/`
   - 将回滚 UI：`tools/.../ui_legacy/` → `./ui_legacy/`
   - 服务端 `http/ui_assets.py` 改为从仓库根读取这些目录（而不是包内相对路径）。
3. **脚本收敛**
   - 新增 `scripts/ui.sh`、`scripts/run.sh` 作为唯一“实现脚本”。
   - 根目录 `ui.sh`/`run.sh` 保持存在，但只做薄转发（兼容旧用法）。
4. **配置路径**
   - 默认配置目录改为：`./config/sidecar/`（显式目录，避免隐藏目录与污染用户主目录）。
   - 启动/加载时做一次性迁移导入：
     - 如果 `./config/sidecar/config.json` 不存在，但检测到旧的 `./.codex-thinking-sidecar/config.json`，则导入并写入新位置。
     - 仍保留从 `CODEX_HOME/tmp` 与 XDG 旧路径导入一次的兜底（仅在新位置没有配置时触发）。
5. **旧结构归档**
   - 当新结构冒烟通过后，将原 `tools/codex_thinking_sidecar/` 迁入 `old/`（或仅保留必要的最小占位/说明文件）。

## 安全与性能
- **安全:** 不新增明文密钥；不触碰外部生产资源；仅做本地文件迁移与默认路径更新
- **性能:** 不改变运行时性能；减少维护成本与误改风险

## 测试与验证
- Python：`python3 -m compileall -q codex_sidecar`
- 服务：启动后校验 `/health`、`/ui`、`/ui/styles.css`，以及 `/api/status` 返回正常
- 快捷启动：验证 `./ui.sh` 与 `./run.sh` 可用
