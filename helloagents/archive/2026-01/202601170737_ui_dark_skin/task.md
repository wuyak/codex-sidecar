# 任务清单：新增 dark 皮肤（CSS variables）+ 少量硬编码背景变量化

- [√] 皮肤下拉增加 `dark`
- [√] `dark` 皮肤通过 CSS variables 覆盖实现（背景/文字/边框/阴影/焦点 ring/Dock/书签）
- [√] 将若干浅色硬编码背景抽为 `--c-soft*` 变量，确保 dark 下不刺眼
- [√] dark 下 badge 颜色做专门覆写（避免浅色背景发白）
- [√] 文档与变更日志更新
- [√] 冒烟验证：`codex_thinking_sidecar --ui` + `/health`、`/ui`、`/ui/styles.css`
- [√] Python：`python3 -m compileall -q tools/codex_thinking_sidecar/codex_thinking_sidecar`

