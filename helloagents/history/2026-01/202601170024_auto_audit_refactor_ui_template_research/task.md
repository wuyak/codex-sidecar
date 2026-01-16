# 任务清单：全仓检查/轻量重构/测试 + UI 模板调研报告

## 代码与测试
- [√] 全仓 Python 静态编译检查：`python3 -m compileall -q .`
- [√] UI 服务冒烟测试：启动 `codex_thinking_sidecar --ui` 并校验 `/health`、`/ui`、`/ui/styles.css` 可访问
- [√] 轻量重构：UI 样式层级/尺寸常量抽为 CSS Variables，书签栏不占用主列表宽度

## 知识库
- [√] 同步更新：侧栏/书签栏位置与交互说明
- [√] 更新变更日志

## 调研
- [√] 在线调研：可直接集成的前端模板/设计系统（适配“纯静态，无构建”约束）
- [√] 输出详尽报告：候选对比、授权/体积/维护成本、接入步骤、推荐方案与迁移路径（见 `helloagents/wiki/modules/ui_template_research.md`）
