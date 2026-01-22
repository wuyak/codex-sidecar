# 任务清单: 前端 UI 全量重构（Vue 3 + Vite）

目录: `helloagents/plan/202601170921_ui_rewrite_vue3_vite/`

---

## 0. 验收基线（必须全部满足）
- [?] 0.1 核心场景对齐 why.md#核心场景 下所有场景
- [√] 0.2 后端 API 与行为不变（除静态资源部署/回滚开关外）

## 1. 工程化与目录结构
- [√] 1.1 新增 Vite+Vue 工程（`tools/codex_thinking_sidecar/codex_thinking_sidecar/ui_v2/`），可 build 输出到 `ui_v2/dist/`
- [√] 1.2 部署产物到 `tools/codex_thinking_sidecar/codex_thinking_sidecar/ui/`，并提供 `/ui-legacy` 回滚/对照（脚本：`ui_v2/deploy.sh`）
- [√] 1.3 Dev 环境：Vite proxy `/api/*` 与 `/events` 到 sidecar（`ui_v2/vite.config.ts`）

## 2. 状态管理与数据流（Store + Services）
- [√] 2.1 实现 API Client（`ui_v2/src/api/client.ts`），覆盖 messages/threads/config/status/translators 与 control 面基础接口
- [√] 2.2 SSE Service：实现“刷新期保护 + 暂存队列 + 批量回放”（`ui_v2/src/services/sse.ts` + store `refreshInFlight`）
- [√] 2.3 实现会话域 Store：thread 排序、未读计数、隐藏会话、书签自定义名称（`ui_v2/src/stores/app.ts`）
- [√] 2.4 消息域 Store：按会话缓存、`op=update` 精准合并、切换稳定（缓存：all + per-key）

## 3. UI 布局与基础组件
- [√] 3.1 AppShell：顶部栏、消息列表区域、右侧工具栏、全局 toast 容器
- [√] 3.2 BookmarksRail：未读徽标、隐藏态展示/切换、重命名交互（“显示隐藏”开关在右侧工具栏）
- [√] 3.3 DrawerConfig：配置项绑定与保存/恢复/提示（当前为 JSON 编辑版；后续如需可再细化为表单）

## 4. 消息渲染（功能对齐）
- [√] 4.1 MessageRow：user/assistant/tool/reasoning 类型渲染对齐 legacy（当前实现集中在 `MessageList.vue`）
- [√] 4.2 ThinkingBlock：EN/ZH 切换、翻译状态、重译按钮，联通 `/api/control/retranslate`（当前实现集中在 `MessageList.vue`）
- [√] 4.3 Markdown 渲染：已在 V2 工程内复用 legacy 渲染逻辑（`ui_v2/src/legacy/markdown/*`），并用于 user/assistant/thinking 渲染

## 5. 性能专项
- [√] 5.1 长列表窗口化落地（接近底部才自动滚动 + “加载更多” + 未读分割提示）
- [√] 5.2 缓存策略：Markdown/格式化缓存、`op=update` 精准更新

## 6. 主题与浮层（置顶问题治理）
- [√] 6.1 主题体系：default/flat/dark 与本机记忆行为对齐
- [√] 6.2 浮层体系：抽屉/toast 使用 Teleport 统一挂载点（`#overlay`）与置顶层级

## 7. 安全检查
- [√] 7.1 安全检查：Markdown 渲染链路默认 escape（`v-html` 仅渲染受控 HTML）

## 8. 文档更新
- [√] 8.1 更新 `helloagents/INDEX.md` 与相关模块文档，记录新 UI 技术栈与目录结构
- [√] 8.2 更新 `helloagents/CHANGELOG.md` 记录重构范围与迁移说明

## 9. 验证与回滚
- [√] 9.1 补齐手工验证清单（按 why.md 核心场景逐条验证），并记录结果
- [√] 9.2 确认 legacy 回滚路径可用（严重回归时可快速切回）

---

## 10. 手工验证记录（2026-01-17）

对齐 `why.md#核心场景`，先提供清单；本次在仓库内可完成的验证以“构建通过 + 代码审计 + 路由可用”为主（交互类需你本机打开浏览器确认）：

- [√] 构建检查：`ui_v2` 已可 `npm run build` 产出静态资源（无 TypeScript 编译错误）。
- [√] 回滚路径：服务端已支持 `/ui-legacy`（可用于严重回归时快速对照/切回）。

- [?] 高频 SSE 下切换会话不串线：请在浏览器打开 `/ui`，高频输出时切换书签观察是否稳定。
- [?] 书签重命名稳定可用：长按进入编辑；Enter/失焦提交；Esc 取消；右键切换隐藏；未读徽标是否正常。
- [?] 长列表可用：默认窗口化渲染（显示最近 N 条），“加载更多”逐步展开；接近底部才自动滚动是否符合预期。
- [?] 配置保存与监听控制：配置抽屉保存/恢复；开始/停止/重启/清空/退出按钮行为是否与现有一致。
- [?] 自动翻译回填与 EN/ZH 切换：未译显示 EN；回填后可查看 ZH；`op=update` 是否不改变时间线位置。
- [?] 手动翻译与重译：思考块按钮触发重译；in-flight 保护；失败可见并可重试。

> 备注：虚拟列表未做“像素级滚动窗口”算法，当前以“窗口化 + 渐进加载更多”作为低复杂度/高收益方案落地。
