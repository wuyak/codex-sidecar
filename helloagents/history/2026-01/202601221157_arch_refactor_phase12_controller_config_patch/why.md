# 变更提案: Controller 配置 patch 逻辑解耦（Phase 12）

## 需求背景
`codex_sidecar/controller_core.py` 的 `_patch_config()` 负责：
- mask secret 回填
- translator_config 的一层 merge（保留其它 provider 配置）
- http profiles 空值保护
- SidecarConfig 构建与（可选）落盘
- 产出 prev_tm/prev_provider/touched_translator 供 watcher 热更新

该逻辑属于“纯配置计算/校验”，与 controller 的线程生命周期/状态管理职责不同。内联在 controller_core 中会增加维护成本，也不利于独立单测覆盖。

## 变更内容
1. 抽离配置 patch/merge/校验逻辑到 `codex_sidecar/control/config_patch.py`
2. `controller_core._patch_config()` 仅负责加锁读写与持久化，保持对外行为不变
3. 增加单元测试覆盖关键语义（translator_config 合并保留、空 http profiles 保护）

## 影响范围
- **模块:** controller / control（配置入口与校验）
- **文件:**
  - `codex_sidecar/controller_core.py`
  - `codex_sidecar/control/config_patch.py`（新增）
  - `tests/test_control_config_patch.py`（新增）
  - `helloagents/wiki/modules/rollout_sidecar.md`
  - `helloagents/CHANGELOG.md`

## 核心场景

### 需求: 降低 controller_core 耦合
**模块:** controller
把“配置 patch 计算”从 controller_core 中抽离，让 controller 更聚焦线程/状态/热更新调度。

#### 场景: UI 保存 openai 配置但保留 http profiles
- 预期结果：`translator_config.http.profiles` 不会被意外清空

#### 场景: UI 选择 http provider 但 profiles 为空
- 预期结果：按现有保护策略抛出 `ValueError("empty_http_profiles")`（除非显式允许空）

## 风险评估
- **风险:** patch 迁移导致 corner case 行为变化（尤其是异常吞吐策略）
- **缓解:** “原逻辑等价迁移”+ 单测覆盖关键分支；全量 `compileall` + `unittest`
