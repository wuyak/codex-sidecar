# 任务清单：UI 皮肤切换（本机记忆）+ mini 按钮去 emoji

- [√] 配置抽屉新增“皮肤（default/flat）”选择器
- [√] 本机持久化：localStorage 保存皮肤并在页面启动时恢复
- [√] 皮肤联动：flat 模式同步调整 Dock/书签观感（背景/边框/阴影）
- [√] mini 按钮改用 SVG 图标（新增/重命名/删除），避免 emoji 字体与风格不一致
- [√] 文档与变更日志更新
- [√] 冒烟验证：`codex_thinking_sidecar --ui` + `/health`、`/ui`、`/ui/styles.css`
- [√] Python：`python3 -m compileall -q tools/codex_thinking_sidecar/codex_thinking_sidecar`

