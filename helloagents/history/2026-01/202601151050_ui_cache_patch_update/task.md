# 轻量迭代任务清单：UI 缓存与翻译回填优化

- [√] Markdown 渲染缓存：按 `msg.id + variant` 缓存 `renderMarkdown()` 输出，提升频繁切换时重绘速度
- [√] 翻译回填最小化：`op=update` 到达时优先原位更新 ZH 区块（保留行内状态，避免整行重绘）
- [√] 文档同步：README / wiki / CHANGELOG
- [√] 质量验证：`node --check`（UI 模块）+ `python3 -m py_compile`
- [√] 迁移方案包至 `helloagents/history/` 并更新 `helloagents/history/index.md`
