# 轻量迭代任务清单：会话清除重启恢复 + 导出纯 Markdown

- [√] UI：将“清除会话”隐藏状态与 sidecar 进程 `boot_id` 绑定（兼容 execv 原地重启 pid 不变），重启后自动恢复可见
- [√] 后端：统一并迁移 `replay_last_lines` 默认值为 200，重启后可回放重建会话列表
- [√] 导出：移除 `<details>/<summary>` 与 HTML 注释，工具输出/参数使用围栏代码块；并将 `<pre class="code">...</pre>` 代码块转换为围栏代码块
- [√] 文档同步：更新 `helloagents/CHANGELOG.md` 与 `helloagents/wiki/modules/rollout_sidecar.md`
- [√] 质量验证：`python3 -m unittest discover` + `node --input-type=module` 导入检查
