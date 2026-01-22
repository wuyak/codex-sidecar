# 变更提案: Config migrations 模块化（Phase25）

## 需求背景
`codex_sidecar/config.py` 同时包含：
- 配置数据结构（`SidecarConfig`）
- 配置加载/保存 IO
- 多处 inplace migration（stub provider、NVIDIA model 修正、replay_last_lines 修复）

其中“migrations”属于纯逻辑/可独立演进的部分，继续堆在 `config.py` 会导致：
- 文件体积持续膨胀，阅读成本高
- 迁移逻辑与 IO/数据结构耦合，未来测试与维护不便

## 变更内容
1. 抽离 `config.py` 内的 invariants + inplace migrations 到新模块 `codex_sidecar/config_migrations.py`
2. `config.py` 保持对外 API 不变（`SidecarConfig/load_config/save_config` 等），仅改为调用新模块

## 影响范围
- **模块:** config
- **文件:**
  - `codex_sidecar/config_migrations.py`
  - `codex_sidecar/config.py`
- **API:** 无（保持外部导入路径与行为一致）
- **数据:** 无

## 核心场景

### 需求: load_config 的迁移行为保持不变
**模块:** config
- 读取当前 config.json 时继续应用：
  - stub/none provider → openai
  - NVIDIA model id 修正
  - replay_last_lines<=0 → 200
- 导入 legacy config（旧目录/快照）时保持仅做 invariants 修正，不额外引入新的迁移副作用

## 风险评估
- **风险:** 抽离后调用顺序/默认值函数传递错误导致迁移不生效
- **缓解:** 复用现有迁移单测（`tests/test_config_load_migrations.py`）做回归验证，并运行全量测试集

