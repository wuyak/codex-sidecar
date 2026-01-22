# 变更提案：离线对话“展示”接入（导入对话 + 只读渲染/翻译/导出复用）

## 需求背景
现有 Sidecar 以“实时监听（Live）”为主：通过 watcher 跟随 `CODEX_HOME/sessions/**/rollout-*.jsonl` 并将解析后的 messages 注入到 SidecarState，前端通过 `/api/messages` + SSE `/events` 渲染。

但用户需要一个更轻量、不会污染实时态的能力：**只读查看历史对话**（离线展示），并且：
- 不要求启动 watcher 进程也能“抓到会话进行渲染”（仅需 sidecar HTTP/UI 存活即可）。
- 离线仅用于回看/归档/导出：不进入 watcher 的 follow/监听集合，不产生未读、不响铃、不改变 follow 策略。
- 复用现有渲染体系：tool 卡片、diff/高亮、代码块、思考块（reasoning_summary）等保持一致。
- 复用现有翻译能力：尽量共用 Live 的翻译接口，不额外引入复杂的离线专用翻译任务系统。
- UI 结构清晰：`监听中 / 展示中 / 关闭监听` 三列表；“导入对话”入口位于右侧工具栏按钮区（避免塞进会话管理抽屉导致心智混乱）。

## 目标与成功标准
- ✅ 提供“导入对话”弹窗：可输入 `rel` 或从最近文件列表选择，将历史会话加入“展示中”并立即打开。
- ✅ 离线会话进入“展示标签栏”（独立一行）与会话管理抽屉的“展示中”列表；关闭=移除展示。
- ✅ 离线渲染与 Live 同 schema：离线 API 返回与 `/api/messages` 一致的消息结构，前端无需分叉渲染逻辑。
- ✅ 翻译共用接口：离线思考块翻译/导出补齐译文使用 `/api/control/translate_text`（不依赖 watcher/SidecarState）。
- ✅ 安全边界：离线读取严格限制在 `CODEX_HOME/sessions/**/rollout-*.jsonl`，禁止任意路径读取。

## 非目标（避免过度设计）
- 不做“离线自动转为监听（pin）”的自动迁移；如未来需要，仅提供显式按钮（另起方案）。
- 不做复杂的“离线导入任务队列/进度条”；以单文件查看为主，支持批量翻译仅用于导出补齐。

## 影响范围（预估）
- UI：导入弹窗与离线文件列表渲染、DOM 绑定、抽屉文案与事件收敛。
- 文档：`helloagents/modules/rollout_sidecar.md` 与 `helloagents/CHANGELOG.md` 更新。

