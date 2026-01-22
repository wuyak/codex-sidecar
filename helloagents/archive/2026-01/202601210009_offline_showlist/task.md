# 标准开发任务清单：离线展示名单（主动读取 rollout 文件）

- [√] 后端：新增 `/api/offline/files` / `/api/offline/messages` / `/api/offline/translate`，并限制只允许读取 `CODEX_HOME/sessions/**/rollout-*.jsonl`
- [√] 前端：会话管理抽屉新增“展示名单”区（最近文件列表 + 手动输入 rel 打开）
- [√] 前端：离线会话以 `offline:*` 进入标签栏/导出/翻译，但不触发 follow 选择、不计未读不响铃
- [√] 前端：离线思考翻译（本地缓存回填）+ 导出补齐译文（调用 `/api/offline/translate`）
- [√] 文档同步：更新 `helloagents/CHANGELOG.md` 与 `helloagents/modules/rollout_sidecar.md`
- [√] 质量验证：`python3 -m unittest discover` + `node --input-type=module` 导入检查

