# 变更提案: NVIDIA 翻译模块分层重构（Phase 9）

## 需求背景
当前 `codex_sidecar/translators/nvidia_chat_core.py` 集中承载了提示词构造、输出抽取、错误解析、Markdown 质量门禁、超时/重试启发式等多类职责，文件体积偏大且跨职责逻辑耦合，后续维护与定位问题成本较高。

## 变更内容
1. 抽离 NVIDIA 翻译相关的“纯函数/辅助逻辑”到独立模块，形成更清晰的分层边界
2. 保持对外行为不变：不修改对外 API、配置项、默认值与运行时输出语义
3. 补充单元测试覆盖关键纯函数，降低未来重构回归风险

## 影响范围
- **模块:** translators（NVIDIA 翻译实现）
- **文件:**
  - `codex_sidecar/translators/nvidia_chat_core.py`
  - `codex_sidecar/translators/nvidia_chat_helpers.py`（新增）
  - `tests/test_translators_nvidia_chat_helpers.py`（新增）
  - `helloagents/modules/nvidia_translate.md`
  - `helloagents/CHANGELOG.md`

## 核心场景

### 需求: 降低维护复杂度但不改行为
**模块:** translators
在不改变 NVIDIA 翻译输出与回退策略的前提下，将解析/门禁/启发式逻辑从核心 translator 类中解耦出来，便于独立测试与复用。

#### 场景: 正常翻译/回退/错误提示路径均保持一致
- 预期结果：`NvidiaChatTranslator.translate()` 的行为与日志提示不变
- 预期结果：导入路径、配置结构与默认模型不变

## 风险评估
- **风险:** 函数移动导致导入遗漏或名称冲突，引发运行期异常
- **缓解:** 以“helpers 新增 + core 仅改为调用 helpers”为原则；补充单测覆盖关键函数；执行 `compileall` 与单元测试套件
