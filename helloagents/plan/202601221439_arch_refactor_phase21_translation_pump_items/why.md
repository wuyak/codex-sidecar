# 变更提案: TranslationPump item 解析逻辑解耦（Phase21）

## 需求背景
`codex_sidecar/watch/translation_pump_core.py` 的 `_worker()` 里包含多段“从 batch items 提取 id/text、清理无效项、回收 inflight”的内联循环逻辑。

这些逻辑属于可复用的纯数据处理，但目前与线程/队列控制混在一起，导致：
- 阅读成本高（worker 内联分支过多）
- 单测覆盖困难（很难只测“item 解析”而不引入线程）
- 未来微调时更容易引入细微行为差异

## 变更内容
1. 新增 `codex_sidecar/watch/translation_pump_items.py`：抽离 batch items 的 `id/text` 提取与过滤（纯函数）
2. `TranslationPump._worker()` 使用新 helper，并清理无效/未使用的中间变量

## 影响范围
- **模块:** watch
- **文件:**
  - `codex_sidecar/watch/translation_pump_items.py`
  - `codex_sidecar/watch/translation_pump_core.py`
  - `tests/test_translation_pump_items.py`
- **API:** 无
- **数据:** 无

## 核心场景

### 需求: batch items 过滤与清理
**模块:** watch
对 batch items 的解析与过滤保持现有语义：
- 仅接受 `dict` 且包含非空 `id`、非空白 `text` 的项进入 pairs
- 清理/回收 inflight 时仅使用可解析到的 `id`

## 风险评估
- **风险:** helper 提取导致过滤语义变化
- **缓解:** 新增单测覆盖过滤规则，并运行全量单测回归

