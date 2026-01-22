# 任务清单: reveal_secret 逻辑抽离（Phase17）

目录: `helloagents/plan/202601221350_arch_refactor_phase17_reveal_secret/`

---

## 1. 代码重构
- [√] 1.1 新增 `codex_sidecar/control/reveal_secret.py`，实现 reveal_secret 纯逻辑并保持行为等价
- [√] 1.2 重构 `codex_sidecar/controller_core.py` 的 `reveal_secret()` 调用新 helper

## 2. 测试
- [√] 2.1 新增 `tests/test_control_reveal_secret.py` 覆盖 openai/nvidia/http 分支与 profile 兜底

## 3. 文档更新
- [√] 3.1 更新 `helloagents/modules/rollout_sidecar.md`（控制面分层补充）
- [√] 3.2 更新 `helloagents/CHANGELOG.md` 记录本次重构

## 4. 质量检查
- [√] 4.1 运行 `python3 -m compileall -q codex_sidecar`
- [√] 4.2 运行 `python3 -m unittest discover -s tests`

## 5. 方案包迁移
- [√] 5.1 将本方案包迁移至 `helloagents/archive/2026-01/202601221350_arch_refactor_phase17_reveal_secret/` 并更新 `helloagents/archive/_index.md`
