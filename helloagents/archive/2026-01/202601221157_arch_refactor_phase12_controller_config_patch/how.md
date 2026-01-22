# 技术设计: Controller 配置 patch 逻辑解耦（Phase 12）

## 技术方案

### 核心技术
- Python 3.8
- “controller_core（锁/持久化） + control/config_patch（纯逻辑）”分层

### 实现要点
- 新增 `codex_sidecar/control/config_patch.py`
  - 输入：当前 config dict、patch dict、config_home、是否允许空 profiles
  - 输出：新的 `SidecarConfig`、序列化 dict、以及 hot-update 所需的 prev_tm/prev_provider/touched_translator
  - 复用现有函数：`restore_masked_secrets_in_patch`、`count_valid_http_profiles`
- `controller_core._patch_config()`：
  - 锁内：取当前 cfg → 调用 config_patch → 写回 self._cfg →（可选）save_config
  - 锁外：调用 `_apply_watcher_hot_updates()`（保持现有死锁规避策略）

## 安全与性能
- **安全:** 不引入新的敏感信息输出；mask secret 回填策略保持一致
- **性能:** 纯逻辑拆分不改变复杂度；提升可读性与可测试性

## 测试与部署
- **测试:** 新增 `tests/test_control_config_patch.py` 覆盖关键分支；跑全量 `unittest` + `compileall`
- **部署:** 无（内部重构）
