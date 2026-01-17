# 技术设计: 仓库整理（Phase 1：归档无用草稿到 old/）

## 技术方案
### 核心技术
- 文件系统目录整理（`mv` 归档）
- `.gitignore` 规则补充（防止缓存误入版本控制）

### 实现要点
- 归档目录：在仓库根新增 `old/`。
- 归档策略：优先“按原路径镜像”归档，减少回看时的认知成本（例如 `tools/.../ui_v2` → `old/tools/.../ui_v2`）。
- 保留范围（Phase 1）：
  - 保留当前运行主链路：`tools/codex_thinking_sidecar/codex_thinking_sidecar/ui/` 与 Python 服务端代码。
  - 保留可选回滚：`tools/codex_thinking_sidecar/codex_thinking_sidecar/ui_legacy/`（本 Phase 暂不移动，避免失去兜底）。
- 归档对象（Phase 1）：
  - `tools/codex_thinking_sidecar/codex_thinking_sidecar/ui_v2/`
  - `tools/codex_thinking_sidecar/codex_thinking_sidecar/ui_v2_deployed_*`
  - `tools/codex_thinking_sidecar/codex_thinking_sidecar/ui_legacy_*`（时间戳快照目录）
  - `tools/codex_thinking_sidecar/codex_thinking_sidecar/*.lnk`（明显非运行所需）
  - （可选）仓库根的本地缓存目录：`.npm-cache/`、`.codex-home/`（如移动，则必须在 `.gitignore` 中继续忽略其在 `old/` 下的新位置）

## 安全与性能
- **安全:** 不触及生产环境与密钥；仅做本地文件整理。
- **性能:** 减少目录扫描与人肉定位成本；不改变运行时性能。

## 测试与部署
- **测试:** 冒烟验证：
  - Python：`python3 -m compileall -q tools/codex_thinking_sidecar/codex_thinking_sidecar`
  - 服务：启动后访问 `/health` 与 `/ui`（可选 `/ui-legacy`）
- **部署:** 不引入新部署方式；仍沿用现有 `run.sh`/`ui.sh`。

## Phase 2 预告（不在本方案包执行）
Phase 2 将进行“彻底扁平化”：把后端从 `tools/` 迁出并统一为更清晰的顶层结构（并按需要改名为 `codex_sidecar`），需要更严格的回归验证与一次性路径更新。  
