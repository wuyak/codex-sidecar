# 变更提案: config.load_config 结构化重构（Phase 13）

## 需求背景
`codex_sidecar/config.py` 的 `load_config()` 目前包含多段迁移/兼容逻辑（provider 迁移、NVIDIA 模型纠正、replay_last_lines 默认修复、旧配置目录导入、legacy snapshot 导入），以嵌套 `try/except` 形式集中在一个函数内，阅读与维护成本较高。

该模块属于项目的 SSOT 之一（配置加载/迁移决定运行行为）。我们希望在**不改变行为**的前提下，把逻辑拆分为清晰的步骤函数，便于未来扩展与测试。

## 变更内容
1. 将 `load_config()` 拆分为“读取当前配置 → 应用迁移 → 旧目录导入 → legacy snapshot 导入 → 默认配置”的线性流程
2. 抽出迁移与导入的内部 helper（仍在 `config.py` 内部，避免循环依赖），减少深层嵌套
3. 补充单元测试覆盖关键迁移语义（`replay_last_lines` 修复、stub provider 迁移、NVIDIA 模型纠正）

## 影响范围
- **模块:** config（配置加载与迁移）
- **文件:**
  - `codex_sidecar/config.py`
  - `tests/test_config_load_migrations.py`（新增）
  - `helloagents/CHANGELOG.md`
  - `helloagents/wiki/modules/rollout_sidecar.md`（如需补充说明）

## 核心场景

### 需求: 行为保持不变但更易维护
**模块:** config
重构后 `load_config()` 的返回值与落盘行为保持一致，且迁移顺序不变。

#### 场景: replay_last_lines=0 的旧配置
- 预期结果：加载后自动修复为 200，并写回 config.json

#### 场景: translator_provider=stub/none 的旧配置
- 预期结果：加载后自动迁移到 openai，并写回 config.json（不丢其他 provider 配置）

## 风险评估
- **风险:** 迁移/导入的异常吞吐策略微变导致“本应继续回退”的路径提前退出
- **缓解:** 以原 try/except 边界为基准拆分；补充单测覆盖关键迁移；全量 `compileall` + `unittest`
