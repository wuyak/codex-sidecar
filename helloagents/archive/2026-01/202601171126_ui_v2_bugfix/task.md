# 任务清单: UI v2 Bugfix（工具输出可见性 / 单会话拉取修复）

目录: `helloagents/plan/202601171126_ui_v2_bugfix/`

---

## 1. 问题修复
- [√] 1.1 修复 API Client 对带 query 的路径追加 `t=` 时的 `?`/`&` 拼接错误（影响：`/api/messages?thread_id=`）
- [√] 1.2 tool_call/tool_output 默认展示“预览”内容（避免仅看到 call_id 误以为无输出）
- [√] 1.3 Teleport 置顶挂载点 `#overlay` 的 pointer-events 策略修正（抽屉可交互）

## 2. 构建与部署
- [√] 2.1 `ui_v2` 构建通过
- [√] 2.2 `ui_v2/deploy.sh` 部署到 `ui/`，并保留备份目录 `ui_legacy_YYYYMMDDHHMMSS/`

## 3. 基础验证
- [√] 3.1 `/health`、`/ui`、`/ui-legacy` 路由可用（HTTP 200）

## 4. 需要你本机确认（浏览器交互）
- [?] 4.1 单会话书签切换后能正常拉取消息（不再为空）
- [?] 4.2 tool_call/tool_output 行默认可见预览内容；点击“详情”可展开/收起
