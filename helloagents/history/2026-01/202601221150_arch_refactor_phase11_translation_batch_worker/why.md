# 变更提案: TranslationPump 批量翻译执行解耦（Phase 11）

## 需求背景
`codex_sidecar/watch/translation_pump_core.py` 的 `_worker()` 同时承担了队列调度、batch 组装、批量翻译执行、解包与回退等多类职责。虽然现有行为正确，但单函数偏长、分支密集，后续维护与回归测试成本偏高。

## 变更内容
1. 抽离“批量翻译执行/解包/回退”的逻辑到独立模块，降低 `TranslationPump` 内联复杂度
2. 保持行为不变：批量失败不做逐条回退（避免请求风暴）、解包缺失时逐条回退策略保持一致、stop_event 中断时的 best-effort 语义保持一致
3. 增补单元测试覆盖抽离模块关键语义（空输出不回退、缺失项回退、stop 中断）

## 影响范围
- **模块:** watch（翻译队列）
- **文件:**
  - `codex_sidecar/watch/translation_pump_core.py`
  - `codex_sidecar/watch/translation_batch_worker.py`（新增）
  - `tests/test_translation_batch_worker.py`（新增）
  - `helloagents/wiki/modules/rollout_sidecar.md`
  - `helloagents/CHANGELOG.md`

## 核心场景

### 需求: 可维护性提升但不改行为
**模块:** watch
把 batch 翻译“执行/解包/回退/回填”抽成可测试单元，使 `TranslationPump._worker()` 更聚焦队列调度与统计。

#### 场景: 批量请求返回空输出
- 预期结果：对所有条目回填 `translate_error`（不做逐条回退翻译，避免放大请求）

#### 场景: 解包缺失某条目
- 预期结果：对缺失条目做逐条回退翻译（有界），避免 UI 静默缺段

## 风险评估
- **风险:** 中断/异常路径的 done_id/计数更新时序微变
- **缓解:** 采用“回调注入 + 原代码顺序迁移”方式，保持 stop_event 检查点一致；增加单测覆盖 stop 中断行为
