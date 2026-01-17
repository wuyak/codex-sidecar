# 任务清单: 仓库彻底扁平化（Phase 2）

目录: `helloagents/plan/202601172149_repo_flatten_phase2/`

---

## 1. 迁移后端与 UI
- [√] 1.1 新建顶层目录：`codex_sidecar/`、`ui/`、`ui_legacy/`、`scripts/`、`config/sidecar/`
- [√] 1.2 迁移后端：`tools/codex_thinking_sidecar/codex_thinking_sidecar/*` → `codex_sidecar/`
- [√] 1.3 迁移默认 UI：`tools/.../ui/*` → `ui/`
- [√] 1.4 迁移回滚 UI：`tools/.../ui_legacy/*` → `ui_legacy/`

## 2. 路径与启动脚本
- [√] 2.1 调整服务端静态资源路径：更新 `codex_sidecar/http/ui_assets.py` 读取顶层 `ui/`、`ui_legacy/`
- [√] 2.2 新增 `scripts/ui.sh`、`scripts/run.sh`：统一启动逻辑与默认 `--config-home ./config/sidecar`
- [√] 2.3 根目录 `ui.sh`、`run.sh` 改为薄 wrapper（转发到 `scripts/`）

## 3. 配置迁移
- [√] 3.1 更新 `codex_sidecar/config.py`：默认配置目录改为 `./config/sidecar`
- [√] 3.2 在加载配置时加入对 `./.codex-thinking-sidecar` 的一次性导入（新位置不存在配置时触发）

## 4. 归档旧结构
- [√] 4.1 新结构冒烟通过后，将 `tools/codex_thinking_sidecar/` 整体移入 `old/`

## 5. 文档与忽略规则
- [√] 5.1 更新 `.gitignore`：忽略 `config/sidecar/`、以及 `old/` 下潜在缓存
- [√] 5.2 更新 `README.md`/知识库：说明新目录结构与启动方式

## 6. 安全检查
- [√] 6.1 执行安全检查（按G9：仅迁移/重命名，不做破坏性删除）

## 7. 测试
- [√] 7.1 Python 冒烟：`python3 -m compileall -q codex_sidecar`
- [√] 7.2 服务冒烟：启动后校验 `/health`、`/ui`、`/ui/styles.css`、`/api/status`
