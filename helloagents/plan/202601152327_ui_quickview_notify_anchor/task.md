# 任务清单: UI 快速浏览/提醒/落点稳定 + 翻译/审批边界 + 全局优化

目录: `helloagents/plan/202601152327_ui_quickview_notify_anchor/`

---

## 1. UI：精简显示（快速浏览）
- [√] 1.1 增加 `view_mode=full|quick` 状态（localStorage 持久化），并在右侧工具栏增加切换按钮
- [√] 1.2 quick 模式下仅显示 `user_message/assistant_message/reasoning_summary/agent_reasoning`，其余类型隐藏（CSS 驱动，避免破坏 timeline）
- [√] 1.3 quick/full 切换时不触发全量 refreshList（避免闪烁/上下文丢失），并给出轻提示（避免误以为丢数据）

## 2. UI：右下角提醒（通知中心）
- [√] 2.1 新增通知组件（纯前端，支持去重/TTL/渐淡）
- [√] 2.2 tool gate 触发提醒：`kind=tool_gate` 且为 waiting 时弹出提示；released 时可选提示或静默消退
- [√] 2.3（可选）新输出提醒：当用户不在底部且出现新 `assistant_message` 时提示“有新输出”（需节流/去重，避免刷屏）

## 3. UI：落点不漂移（切换锚点修正）
- [√] 3.1 实现通用锚点修正 helper（切换前后比对 `getBoundingClientRect().top` 并 `scrollBy`）
- [√] 3.2 思考块 EN/ZH 切换接入锚点修正（`ui/app/main.js`）
- [√] 3.3 代码块详情/摘要切换接入锚点修正（`decorate/tool_toggle.js` + `decorate/copy_hold.js` 点击路径）

## 4. 翻译：错误机制与边界条件复核（需求1更新）
- [√] 4.1 复核失败/超时/空译文：仅回填 `translate_error`，不写入 `zh`；UI pill/按钮状态一致
- [√] 4.2 复核 in-flight 生命周期：成功/失败都清除；支持手动“重试”
- [√] 4.3 复核批量翻译：仅导入期聚合、不同会话不串流；批量失败不触发请求风暴（必要时限制 fallback）
- [ ] 4.4 文档补充：推荐 timeout 下限与常见失败原因（避免误配置导致大量 timeout）

## 5. 审批信息：展示内容优化（需求2更新）
- [√] 5.1 `tool_gate` 提示仅保留：工具/命令/justification；隐藏 `call_id`
- [√] 5.2 审计脱敏策略：避免 URL/token 泄露到 UI
- [ ] 5.3 文档更新：明确“justification 来源”与“多会话全局日志可能不属于当前会话”的免责声明

## 6. 会话管理（来自图片的管理诉求，安全优先）
- [ ] 6.1 增加“导出当前会话为 Markdown/文本”（只读，不触碰文件系统会话数据）
- [ ] 6.2 增加“隐藏/收藏会话”（仅本机 localStorage，不删除真实 `rollout-*.jsonl`）
- [ ] 6.3 ⚠️ 如必须支持“删除会话文件”：单独评审 EHRB 风险与备份策略后再做（默认不实现）

## 7. 完成后：全局代码分析与优化（新要求）
- [ ] 7.1 扫描并重构：抽出重复逻辑（通知/锚点/过滤），减少长文件与交叉依赖
- [ ] 7.2 稳定性检查：长时间挂起 + ≥3 会话切换 + SSE 重连场景回归
- [ ] 7.3 更新知识库：同步 `helloagents/wiki/modules/rollout_sidecar.md` 与 `README.md`，保持文档与代码一致

## 8. 安全检查
- [ ] 8.1 输入校验：所有 UI 控制接口参数做最小校验（避免异常值导致 watcher 异常）
- [√] 8.2 敏感信息：URL/token/Authorization 等统一脱敏展示

## 9. 验证与提交
- [√] 9.1 `python3 -m py_compile ...`（相关模块）
- [√] 9.2 `node --check`（相关 UI 模块）
- [ ] 9.3 手工验证：quick/full、提醒、落点稳定、翻译重试、多会话切换
- [ ] 9.4 git 提交（按功能拆分提交，便于回滚）
