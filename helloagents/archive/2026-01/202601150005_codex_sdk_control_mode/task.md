# 任务清单: Codex SDK 控制模式（浏览器输入 → 本机持续对话）

目录: `helloagents/plan/202601150005_codex_sdk_control_mode/`

---

## 1. codex_sdk（Node bridge）
- [√] 1.1 在 `src/codex-sdk/` 创建 Node 工程骨架（`package.json`/启动脚本/最小 README），验证 why.md#需求-在浏览器中持续对话-场景-新建并开始一段对话
- [√] 1.2 在 `src/codex-sdk/` 实现 thread 生命周期：start/resume（对接 `codex.startThread()` / `codex.resumeThread()`），验证 why.md#需求-在浏览器中持续对话-场景-续聊恢复-thread
- [√] 1.3 在 `src/codex-sdk/` 实现 turn 执行：`thread.run(prompt)`（MVP 先做非流式），验证 why.md#需求-在浏览器中持续对话-场景-新建并开始一段对话
- [-] 1.4 在 `src/codex-sdk/` 增加中断能力（SDK runner 当前为短命进程模型；暂不提供 interrupt，见 how.md#已知限制）
- [√] 1.5 为 `src/codex-sdk/` 增加最小安全防护（仅 localhost + CSRF），并在 UI 上提示风险，验证 why.md#风险评估

## 2. rollout_sidecar（Python 聚合与启动管理）
- [√] 2.1 在 `tools/codex_thinking_sidecar/codex_thinking_sidecar/server.py` 增加 `/api/sdk/*` 入口（调用 Node runner），验证 why.md#需求-在浏览器中持续对话-场景-新建并开始一段对话
- [-] 2.2 在 `ui.sh` 中增加启动 Node bridge 的可选开关（采用 runner 模式，不需要常驻 bridge 进程）

## 3. UI（输入与会话管理）
- [√] 3.1 在 `tools/codex_thinking_sidecar/codex_thinking_sidecar/ui/` 增加“控制模式”输入区（发送/回车发送/禁用状态），验证 why.md#需求-在浏览器中持续对话-场景-新建并开始一段对话
- [√] 3.2 增加 thread 管理（展示/粘贴恢复 threadId、从选中会话一键填入），验证 why.md#需求-在浏览器中持续对话-场景-续聊恢复-thread
- [ ] 3.3 （可选）接入 SSE 流式输出，把 SDK 事件映射为现有消息卡片，验证 why.md#需求-在浏览器中持续对话-场景-新建并开始一段对话
- [ ] 3.4 （可选）支持“待确认/审批”卡片并回传决策，验证 why.md#需求-在浏览器中持续对话-场景-需要人工确认审批可选

## 4. 安全检查
- [√] 4.1 执行安全检查（按G9：输入验证、CSRF、默认仅 loopback、避免暴露到非本机地址）

## 5. 文档更新
- [√] 5.1 更新 `helloagents/modules/codex_sdk.md`（从规划中 → 开发中/MVP），验证 why.md#变更内容
- [√] 5.2 更新 `helloagents/context.md` 与 `helloagents/INDEX.md`，同步“旁路 + 控制模式”的范围边界

## 6. 测试
- [√] 6.1 增加最小端到端自测脚本（启动 → 新建 thread → 发送一条消息 → 收到输出），验证 why.md#需求-在浏览器中持续对话-场景-新建并开始一段对话
