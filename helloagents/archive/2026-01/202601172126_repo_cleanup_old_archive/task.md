# 任务清单: 仓库整理（Phase 1：归档无用草稿到 old/）

目录: `helloagents/plan/202601172126_repo_cleanup_old_archive/`

---

## 1. 归档整理
- [√] 1.1 新建仓库根目录 `old/`，并建立必要的子目录用于镜像归档
- [√] 1.2 将 `tools/codex_thinking_sidecar/codex_thinking_sidecar/ui_v2/` 归档到 `old/`（不影响 `/ui`）
- [√] 1.3 将 `tools/codex_thinking_sidecar/codex_thinking_sidecar/ui_v2_deployed_*` 归档到 `old/`
- [√] 1.4 将 `tools/codex_thinking_sidecar/codex_thinking_sidecar/ui_legacy_*`（时间戳快照）归档到 `old/`
- [√] 1.5 将 `tools/codex_thinking_sidecar/codex_thinking_sidecar/*.lnk` 归档到 `old/`
- [√] 1.6 （可选）将仓库根的 `.npm-cache/`、`.codex-home/` 归档到 `old/`（如执行需同步 `.gitignore`）

## 2. 兼容性与清理
- [√] 2.1 更新 `.gitignore`：确保 `old/` 下的缓存目录仍被忽略，避免误入版本控制
- [√] 2.2 保持现有启动入口不变：`./run.sh`、`./ui.sh` 仍可用

## 3. 安全检查
- [√] 3.1 执行安全检查（按G9：不新增明文密钥、不做破坏性删除、仅做归档移动）

## 4. 文档更新
- [√] 4.1 更新 `helloagents/CHANGELOG.md`：记录 Phase 1 归档整理
- [√] 4.2 更新知识库模块文档（如需要）：说明当前主 UI 目录仍为 `.../ui/`，v2/快照已归档

## 5. 测试
- [√] 5.1 Python 冒烟：`python3 -m compileall -q tools/codex_thinking_sidecar/codex_thinking_sidecar`
- [√] 5.2 服务冒烟：启动后校验 `/health` 与 `/ui` 可访问
