# 变更提案: 文档一致性补齐（README + 知识库结构）（Phase56）

## 背景
知识库目录已升级为 v3 布局（`helloagents/INDEX.md` + `helloagents/modules/` + `helloagents/archive/` 等），但 README 仍描述为 “wiki/history”，与当前实际结构不一致。

## 目标
- 更新 README 的目录结构说明，使其与仓库当前的知识库结构一致。

## 非目标
- 不改任何运行时代码逻辑。

## 验收标准
- `git diff` 中仅包含文档/知识库变更。

