# 变更提案: 仓库卫生与文档一致性补齐（Phase55）

## 背景
Phase54 已完成关键架构优化（SSE 断线补齐、脚本去重、config 默认值整理）。继续向“可维护性/可迁移性”推进时，仍有少量基础设施与文档一致性问题值得顺手补齐：
- `.gitignore` 未忽略本地工具生成目录（如 `.ace-tool/`），容易造成工作区噪音与误提交风险。
- 启动脚本中的 Python 片段未显式启用 UTF-8（更严格场景下可能导致编码差异）。
- 模块文档尚未记录 SSE `Last-Event-ID` 断线补齐与 `id:` 行策略（SSOT 与代码存在轻微落差）。

## 目标
- 补齐 `.gitignore` 以覆盖常见本地工具目录。
- 提升启动脚本的编码一致性（显式 `python3 -X utf8`）。
- 同步模块文档，保持“文档一等公民”。

## 非目标
- 不改变任何业务行为/交互逻辑。
- 不引入第三方依赖。

## 验收标准
- `bash -n scripts/run.sh scripts/ui.sh scripts/_common.sh`
- `python3 -m compileall -q codex_sidecar`
- `python3 -m unittest discover -s tests`

