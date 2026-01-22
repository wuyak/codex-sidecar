# 技术设计: Config migrations 模块化（Phase25）

## 技术方案
- 新增 `codex_sidecar/config_migrations.py`：
  - `ensure_cfg_invariants(cfg, config_home, default_watch_codex_home=...)`
  - `apply_inplace_migrations(cfg, config_home, save_config=...)`
- 通过“传入 callable”的方式避免模块间循环依赖（`config_migrations.py` 不直接 import `config.py`）

## 实现要点
- 迁移逻辑代码尽量原样搬迁（最小改动）
- `config.py` 仅保留：
  - 数据结构（`SidecarConfig`）
  - `load_config/save_config` 与 legacy import
  - 默认值/路径计算

## 测试与部署
- **测试:** 运行 `tests/test_config_load_migrations.py` + 全量测试
- **部署:** 无（结构性重构，行为不变）

