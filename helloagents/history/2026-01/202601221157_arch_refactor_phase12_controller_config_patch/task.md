# 任务清单: Controller 配置 patch 逻辑解耦（Phase 12）

目录: `helloagents/plan/202601221157_arch_refactor_phase12_controller_config_patch/`

---

## 1. control 分层
- [√] 1.1 新增 `codex_sidecar/control/config_patch.py`：实现配置 patch/merge/校验抽离
- [√] 1.2 重构 `codex_sidecar/controller_core.py`：调用 config_patch，保持行为不变

## 2. 测试
- [√] 2.1 新增 `tests/test_control_config_patch.py` 覆盖 translator_config 合并与空 http profiles 保护

## 3. 安全检查
- [√] 3.1 确认不新增敏感信息输出，mask secret 回填逻辑保持一致（按G9）

## 4. 文档更新
- [√] 4.1 更新 `helloagents/wiki/modules/rollout_sidecar.md` 记录控制面模块边界变化
- [√] 4.2 更新 `helloagents/CHANGELOG.md` 记录本次重构

## 5. 验证
- [√] 5.1 执行 `python3 -m compileall -q codex_sidecar`
- [√] 5.2 执行 `python3 -m unittest discover -s tests`
