# 实施方案：离线对话“展示”接入（导入对话 + 只读渲染/翻译/导出复用）

## 总体架构（数据源模式）
- **Live 数据源**
  - SSE `/events` + `/api/messages`（来自 SidecarState，受 watcher 运行状态影响）
- **Offline 数据源**
  - `/api/offline/files`：只读列出可选历史 `rollout-*.jsonl`
  - `/api/offline/messages?rel=...`：只读解析指定文件，返回与 Live 同 schema 的 `messages[]`

前端按 `key` 前缀区分数据源：
- Live：`key` 为 `thread_id`（或 `all`）
- Offline：`key` 为 `offline:${encodeURIComponent(rel)}`

## 关键标识与一致性规则
- 离线 key：`offline:${encodeURIComponent(rel)}`
  - 仅在 UI/路由/缓存中使用，不进入 watcher follow 集合
- 离线消息 id：`off:${key}:${sha1(rawLine)}`
  - 避免与 Live 的消息 id 冲突（DOM id/缓存/导出都依赖 id）
  - `rawLine` 哈希对“插入行导致行号漂移”更稳健

## UI 设计落地
- 右侧工具栏新增按钮：**导入对话**（弹窗方式，靠近按钮打开，和“精简设置”一致）
- 会话管理抽屉保持三分区：
  - `监听中`：Live 会话列表
  - `展示中`：离线展示列表（持久化）
  - `关闭监听`：本机临时关闭列表（有新输出会自动回到监听中）
- 底部双标签栏：
  - 上方：展示标签栏（Offline）
  - 下方：会话标签栏（Live）

## 离线展示列表与缓存
- 展示中列表：`localStorage offlineShow:1`（保存 `{rel,file?,thread_id?}`）
- 离线译文缓存：`localStorage offlineZh:${rel}`（`{ [msg_id]: zh }`）
  - UI 渲染与导出都会回填该缓存，确保体验一致

## 翻译接口
- 统一使用：`POST /api/control/translate_text`
  - 单条：`{ text } -> { ok, zh, error? }`
  - 批量：`{ items:[{id,text}] } -> { ok, items:[{id, ok, zh, error?}] }`
- Live 的“重译”：继续使用 `/api/control/retranslate`（因为需要回填到 SidecarState 并通过 `/events` 更新 UI）

## 安全与边界
- 离线读取只允许：
  - `rel` 必须以 `sessions/` 开头
  - 实际路径必须在 `CODEX_HOME/sessions` 之内（resolve 后校验 parents）
  - 文件名必须匹配 `rollout-*.jsonl` 的严格正则（包含 thread_id）

## 测试与验证
- 单元测试：`pytest -q`（含离线路径限制与解析逻辑）
- 手动验证：
  - watcher 未启动：打开 UI → 导入对话 → 选择历史文件 → 渲染成功
  - 离线思考翻译：点“翻译/重译” → 走 translate_text → 回填本机缓存 → 重新打开仍可见
  - 导出：离线会话导出（精简/全量、译文/原文）可用，缺失译文时能补齐并持久化

