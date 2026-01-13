# 任务清单: tool_call / tool_output 友好展示与格式化

目录: `helloagents/plan/202601131400_toolcall_tooloutput_pretty/`

---

## 1. UI 结构化渲染
- [√] 1.1 在 `tools/codex_thinking_sidecar/codex_thinking_sidecar/server.py` 为 tool_call/tool_output 增加解析器（tool_name/call_id/args/output）
- [√] 1.2 在 `tools/codex_thinking_sidecar/codex_thinking_sidecar/server.py` 建立 `call_id -> tool_call` 映射，用于 tool_output 摘要与上下文展示
- [√] 1.3 `update_plan`：将 plan 渲染为分行列表（不直接显示 JSON）
- [√] 1.4 `shell_command`：将 workdir/command 分离展示（不直接显示参数 JSON）
- [√] 1.5 tool_output：折叠摘要改为 tool_name/exit code/命令摘要；去掉 call_id 作为摘要

## 2. 文档与记录
- [√] 2.1 更新 `helloagents/wiki/modules/rollout_sidecar.md`：说明 tool_call/tool_output 会做友好格式化，原始内容仍可展开查看
- [√] 2.2 更新 `helloagents/CHANGELOG.md`：记录 UI 展示优化

## 3. 验证
- [√] 3.1 `py_compile` 通过
- [√] 3.2 UI 启动 `/ui` 正常；SSE 渲染不报错
