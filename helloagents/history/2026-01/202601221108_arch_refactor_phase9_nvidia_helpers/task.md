# 任务清单: NVIDIA 翻译模块分层重构（Phase 9）

目录: `helloagents/plan/202601221108_arch_refactor_phase9_nvidia_helpers/`

---

## 1. translators 分层
- [√] 1.1 新增 `codex_sidecar/translators/nvidia_chat_helpers.py`：迁移解析/门禁/启发式等纯逻辑函数
- [√] 1.2 重构 `codex_sidecar/translators/nvidia_chat_core.py`：保持 `NvidiaChatTranslator` 对外行为不变，改为调用 helpers

## 2. 测试
- [√] 2.1 新增 `tests/test_translators_nvidia_chat_helpers.py` 覆盖关键纯函数（Markdown 门禁/Retry-After 解析/错误详情抽取等）

## 3. 安全检查
- [√] 3.1 检查 helpers 是否引入新的敏感信息泄漏路径（按G9）

## 4. 文档更新
- [√] 4.1 更新 `helloagents/wiki/modules/nvidia_translate.md` 说明新的模块边界
- [√] 4.2 更新 `helloagents/CHANGELOG.md` 记录本次重构

## 5. 验证
- [√] 5.1 执行 `python3 -m compileall -q codex_sidecar`
- [√] 5.2 执行 `python3 -m unittest discover -s tests`
