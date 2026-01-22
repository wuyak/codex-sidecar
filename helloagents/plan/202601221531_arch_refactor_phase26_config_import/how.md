# 技术设计: Config legacy import 模块化（Phase26）

## 技术方案
- 新增 `codex_sidecar/config_import.py`：
  - `try_import_from_legacy_homes(...)`
  - `try_import_from_legacy_snapshots(...)`
- 通过传入 `SidecarConfig.from_dict` / `config_path` / `_legacy_config_path` / `save_config` 等 callable，避免循环依赖

## 实现要点
- 代码尽量原样迁移（最小行为差异）
- `config.py` 仍保持 load_config 顺序：
  1. 当前 config_home/config.json
  2. legacy homes
  3. legacy snapshots
  4. default_config

## 测试与部署
- **测试:** 新增 `tests/test_config_import_legacy.py` 覆盖 legacy homes 与 snapshots 的导入与持久化
- **部署:** 无（结构性重构，行为不变）

