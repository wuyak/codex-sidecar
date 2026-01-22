# 任务清单: FollowPicker 进程扫描逻辑解耦（Phase14）

目录: `helloagents/plan/202601221237_arch_refactor_phase14_follow_picker_helpers/`

---

## 1. watch 模块
- [√] 1.1 新增 `codex_sidecar/watch/process_follow_scan.py`，抽离进程强匹配扫描/进程树收集/rollout fd 解析逻辑，验证 why.md#需求-自动发现新增-codex-进程
- [√] 1.2 重构 `codex_sidecar/watch/follow_picker.py` 调用新模块，保持行为不变并保留既有 patch 路径，验证 why.md#需求-仅跟随进程正在写入的-rollout-文件

## 2. 测试
- [√] 2.1 新增 `tests/test_process_follow_scan.py` 覆盖强匹配、进程树与 fd flags 过滤关键分支

## 3. 文档更新
- [√] 3.1 更新 `helloagents/modules/rollout_sidecar.md` 记录模块拆分
- [√] 3.2 更新 `helloagents/CHANGELOG.md` 记录本次重构

## 4. 质量检查
- [√] 4.1 运行 `python3 -m compileall -q codex_sidecar`
- [√] 4.2 运行 `python3 -m unittest discover -s tests`

## 5. 方案包迁移
- [√] 5.1 将本方案包迁移至 `helloagents/archive/2026-01/202601221237_arch_refactor_phase14_follow_picker_helpers/` 并更新 `helloagents/archive/_index.md`
