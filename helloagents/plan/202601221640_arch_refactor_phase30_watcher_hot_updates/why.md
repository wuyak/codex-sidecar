# 变更提案: watcher 热更新逻辑解耦（Phase30）

## 需求背景
`codex_sidecar/controller_core.py` 的 `_apply_watcher_hot_updates()` 负责把配置变更热应用到运行中的 `RolloutWatcher`：
- translate_mode 的切换
- translator/provider 变更后的翻译器重建与注入
- watcher 的运行时参数（并行会话数、poll/scan 间隔、进程跟随配置等）

该逻辑属于“控制面业务规则”，与 controller 的“线程/锁/生命周期管理”不同关注点。继续内联会导致：
- controller_core 体积继续膨胀
- 逻辑难以独立单测（目前只通过更高层 E2E 间接覆盖）
- 后续改动容易引入热更新回归（尤其是翻译器重建触发条件）

## 变更内容
1. 新增 `codex_sidecar/control/watcher_hot_updates.py`：
   - 抽离“热更新决策 + 调用 watcher API”的逻辑
2. `controller_core._apply_watcher_hot_updates()` 退化为“取 watcher/running/cfg → 调用 helper”
3. 新增单测覆盖关键触发条件（translate_mode/provider/touched_translator + always-apply 的运行时参数）

## 影响范围
- **模块:** control / controller
- **文件:**
  - `codex_sidecar/control/watcher_hot_updates.py`（新增）
  - `codex_sidecar/controller_core.py`
  - `tests/test_watcher_hot_updates.py`（新增）
- **API:** 无（内部重构）
- **数据:** 无

## 风险评估
- **风险:** 热更新触发条件变化导致 watcher 设置不一致
- **缓解:** helper 保持与现有逻辑等价 + 单测覆盖关键分支 + 全量测试回归

