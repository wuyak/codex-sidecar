# 变更提案: Sidecar 配置持久化与 UI 收敛

## 需求背景
当前 sidecar 的配置与 Codex 数据目录（`CODEX_HOME`/`.codex`）耦合，且历史上存在多种备份形态（`bak-*`/`lastgood`）。在 UI/监听进程迭代过程中，容易出现以下问题：

- 配置看似“丢失”：因为配置落在 `CODEX_HOME/tmp`，当启动参数或目录变化时 UI 读取到的是另一份配置。
- 误覆盖风险：Profiles 为空/无效时仍允许保存，可能把历史可用配置覆盖掉。
- UI 噪音：`update_plan`/`apply_patch`/`tool_call` 在不同变体下出现重复块或冗余层级，影响阅读。

## 变更内容
1. 配置持久化与 Codex 数据目录解耦：默认改为写入用户级配置目录（XDG）。
2. 备份机制简化：仅保留 1 份备份文件（覆盖式），降低复杂度。
3. UI 提供“弹提示 + 一键恢复”流程：当检测到 HTTP Profiles 为空且存在可恢复备份时提示恢复。
4. 防误覆盖：禁止保存“空/不可用 HTTP Profiles”（除非显式允许）。
5. UI 工具块收敛：隐藏 `update_plan` 的 `tool_output` 重复输出；`apply_patch` 详情只展示补丁内容；增强 `tool_call` 解析容错以提升关联稳定性。

## 影响范围
- **模块:** rollout_sidecar
- **文件:**
  - `tools/codex_thinking_sidecar/codex_thinking_sidecar/config.py`
  - `tools/codex_thinking_sidecar/codex_thinking_sidecar/cli.py`
  - `tools/codex_thinking_sidecar/codex_thinking_sidecar/controller.py`
  - `tools/codex_thinking_sidecar/codex_thinking_sidecar/server.py`
  - `helloagents/modules/rollout_sidecar.md`
  - `tools/codex_thinking_sidecar/README.md`
  - `helloagents/CHANGELOG.md`

## 核心场景
### 需求: 配置可恢复且不污染 `.codex`
**模块:** rollout_sidecar

#### 场景: 用户保存过多个 HTTP Profiles，但 UI 显示为空
- 预期结果：
  - UI 提示“可从备份恢复”，用户点击确认即可恢复 Profiles。
  - 配置文件默认落在 `~/.config/codex-thinking-sidecar/config.json`，与 `.codex` 解耦。

### 需求: 防止误操作覆盖掉可用配置
**模块:** rollout_sidecar

#### 场景: 用户误删 Profiles 或 URL 为空仍点击保存
- 预期结果：
  - UI 阻止保存并提示先恢复或补齐 Profile。
  - 后端也会拒绝保存空 Profiles（防止前端绕过/异常写入）。

## 风险评估
- **风险:** 配置迁移导致用户找不到旧配置
- **缓解:** 启动时自动从旧路径（`CODEX_HOME/tmp`）迁移一次；恢复逻辑仍兼容旧备份文件
