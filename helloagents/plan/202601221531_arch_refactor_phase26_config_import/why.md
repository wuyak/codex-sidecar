# 变更提案: Config legacy import 模块化（Phase26）

## 需求背景
`codex_sidecar/config.py` 当前仍包含两段较长的 legacy import 逻辑：
- `_try_import_from_legacy_homes`：旧配置目录导入（多候选 + mtime 选择）
- `_try_import_from_legacy_snapshots`：CODEX_HOME/tmp 快照导入（.lastgood/.bak-*）

这些逻辑属于“配置导入策略”，与 `SidecarConfig` 数据结构及 `load_config/save_config` 的核心 IO 可以解耦，继续内联会导致：
- `config.py` 仍然偏大、职责混杂
- 导入逻辑难以做针对性单测（目前缺少覆盖）

## 变更内容
1. 抽离 legacy import 逻辑到 `codex_sidecar/config_import.py`
2. `config.py` 保持对外 API 与导入优先级顺序不变，仅改为调用新模块
3. 新增回归测试覆盖 legacy homes / legacy snapshots 的导入行为

## 影响范围
- **模块:** config
- **文件:**
  - `codex_sidecar/config_import.py`
  - `codex_sidecar/config.py`
  - `tests/test_config_import_legacy.py`
- **API:** 无
- **数据:** 无

## 核心场景

### 需求: legacy homes 导入（工作目录下 .codex-thinking-sidecar）
**模块:** config
- 当当前 config 缺失时，能从 legacy home 导入并写入新位置
- 返回 cfg 的 `config_home` 会被修正为当前 config_home

### 需求: legacy snapshots 导入（CODEX_HOME/tmp）
**模块:** config
- 当 legacy homes 不存在时，能从快照文件导入并写入新位置
- 仍保持按 mtime 选择“最新候选”的策略

## 风险评估
- **风险:** 抽离后导入优先级/候选排序细节变化
- **缓解:** 新增端到端单测覆盖关键分支，并运行全量测试集回归

