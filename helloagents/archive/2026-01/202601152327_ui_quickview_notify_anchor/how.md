# 技术设计: UI 快速浏览/提醒/落点稳定 + 翻译/审批边界 + 全局优化

## 技术方案

### 1) 精简显示（快速浏览）
目标：只展示三类块（输入/输出/思考），同时保持 SSE 摄取与时间线不变。

实现要点：
- 引入 UI 侧状态 `view_mode=full|quick`（localStorage 持久化，默认 full）。
- 使用 **CSS class + 选择器隐藏** 的方式实现（推荐），避免重建 DOM/影响 timeline/rowIndex。
  - `body.quick-view .row.kind-tool_call { display:none }` 等。
  - “输入/输出/思考”的映射：
    - 输入：`user_message`
    - 输出：`assistant_message`
    - 思考：`reasoning_summary` / `agent_reasoning`
  - 其余类型（`tool_call/tool_output/tool_gate` 等）在 quick 模式隐藏。
- 右侧工具栏新增一个按钮切换 quick/full；并在状态栏给出轻提示（避免用户以为丢数据）。

### 2) 右下角提醒（通知中心）
目标：当出现“终端等待批准（tool gate）/关键输出”时，在右下角弹出不打扰但足够醒目的提示。

实现要点：
- 新增纯前端通知模块（例如 `ui/app/utils/notify.js`）：
  - 统一入口：`notify({kind, title, detail, key, ttlMs})`
  - 去重：同一个 `kind+key` 在 TTL 内不重复弹
  - 渐淡消失：默认 2-4 秒，tool gate 可更长或直到释放
- 触发源：
  - `kind=tool_gate` 且文本包含“等待确认”时弹出（并避免多会话刷屏）
  - （可选）当用户不在底部且出现新 `assistant_message` 时弹出“有新输出”（避免频繁提示，需去重/节流）

### 3) 落点不漂移（滚动锚点修正）
目标：单击切换导致高度变化时，自动修正滚动，让“点击位置”仍落在同一块里。

实现要点：
- 在触发切换的点击事件中：
  1. 记录切换前的 `row.getBoundingClientRect().top`
  2. 执行切换（class 切换、hidden 切换等）
  3. `requestAnimationFrame` 后再次读取 `row.getBoundingClientRect().top`
  4. `window.scrollBy(0, afterTop - beforeTop)` 修正滚动
- 覆盖点：
  - 思考块 EN/ZH 切换（`ui/app/main.js`）
  - 代码块详情/摘要切换（`decorate/tool_toggle.js` 与 `decorate/copy_hold.js` 的 onTap 路径）

### 4) 翻译链路边界条件（需求1固化）
目标：明确“失败怎么展示、何时批量、如何去重/限流”，并确保失败不会拖垮 UI。

实现要点：
- 失败不写入 `zh`，以 `translate_error` 字段回填（已实现方向，需系统化复核）。
- 手动翻译：
  - UI in-flight 防抖，失败/成功都必须清除 in-flight（防止卡死）
  - “失败”状态下按钮变为“重试”，并展示简短错误提示（tooltip）
- 自动翻译：
  - 仅在回放导入期对同一会话 key 做有限批量翻译；实时阶段逐条/高优先级
  - 批量失败不进行无限回退，避免请求风暴（必要时仅留极小 fallback 预算）
- 超时/空响应：
  - UI/文档提示合理的 timeout 下限（避免把 `2s` 当默认造成大量 timeout）

### 5) 终端批准信息（需求2复核）
目标：UI 展示“有用且可信”的批准提示；避免冗余字段与误导。

实现要点：
- `tool_gate` 展示字段固定为：
  - 工具名（tool）
  - 原因（justification：来自 tool_call 参数）
  - 命令（command：必要时做敏感信息脱敏）
- 不展示 `call_id`（对用户无帮助，且会造成视觉噪音）。
- 保留“多会话全局日志可能不属于当前会话”的免责声明。

### 6) 完成后全局代码分析与优化（新要求）
目标：完成上述功能后，对代码做一次整体可维护性优化，但不引入构建链/复杂依赖。

执行要点（范围受控）：
- UI：继续拆分长文件、统一状态字段、收敛重复逻辑（如 toast/notify/锚点修正）。
- 后端：清理 watcher/translation 边界条件与日志可观测性，避免隐性死锁/无限队列。
- 文档：更新 `README.md` 与 `helloagents/modules/rollout_sidecar.md`，确保文档与代码一致（SSOT）。

## 安全与性能
- **安全**：旁路只读；“删除会话文件”等破坏性操作默认不提供（如需要必须显式确认并做备份策略）。
- **性能**：quick view 采用 CSS 隐藏避免重绘；通知去重避免刷屏；翻译批量仅用于导入期并限制规模。

## 测试与验证
- Python：`python3 -m py_compile ...`
- UI：`node --check`（关键模块）
- 手工验证：至少 3 个会话并行；quick/full 切换；tool gate 提示；思考/代码切换落点稳定；翻译失败可重试且不污染内容区。

