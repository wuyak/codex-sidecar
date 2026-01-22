# 变更提案: 架构审视与优化（Phase54）

## 背景
当前仓库在 Phase2-Phase53 已完成大规模拆分与解耦，但仍存在一些“架构层面的可维护性债务”：
- SSE 推送逻辑内联在 `codex_sidecar/http/handler.py`，可读性/可测性一般，且断线重连时可能遗漏断线期间新增事件。
- `scripts/run.sh` 与 `scripts/ui.sh` 存在大量重复的端口探测/健康检查/浏览器打开/锁文件读取逻辑，维护成本高且容易漂移。
- `codex_sidecar/config.py` 中部分 dataclass 字段默认值形态偏“历史兼容写法”（如 `translator_config=None`），虽能工作但不利于长期维护与类型推断。

## 目标
- 将 SSE 相关逻辑抽离为独立模块，增加“可选的断线补齐”（基于 `Last-Event-ID`），并补充回归测试。
- 抽取 Bash 启动脚本公共逻辑，降低重复并保持行为一致。
- 清理 config 模型的默认值与序列化逻辑，使其更直观、可维护。

## 非目标
- 不引入新的第三方依赖。
- 不改变 UI 的交互/布局；仅做与 SSE 可靠性相关的后端改进（对 UI 透明）。
- 不合并到 `main` 分支（本次全程在 worktree 分支上完成）。

## 风险与缓解
- SSE 行为变化可能影响 UI 的断线恢复路径：
  - 缓解：仅在客户端发送 `Last-Event-ID` 时才补齐；首连不主动回放历史（UI 仍通过 `/api/messages` 获取历史）。
  - 缓解：新增单测覆盖“断线补齐”与“常规推送”。
- Bash 脚本重构可能引入启动失败：
  - 缓解：保留参数解析与执行命令的原样行为；增加 `bash -n` 语法校验。

## 验收标准
- `python3 -m compileall -q codex_sidecar`
- `python3 -m unittest discover -s tests`
- `bash -n scripts/run.sh scripts/ui.sh scripts/_common.sh`
- 知识库同步：更新 `helloagents/CHANGELOG.md`，并在必要时补充模块文档说明。

