# 任务清单: 仓库卫生与文档一致性补齐（Phase55）

目录: `helloagents/plan/202601230834_arch_refactor_phase55_repo_hygiene_docs/`

---

## 1. 仓库卫生（Phase55.1）
- [ ] 1.1 `.gitignore` 增加 `.ace-tool/`（本地检索/索引目录，避免误提交）。

## 2. 启动脚本编码一致性（Phase55.2）
- [ ] 2.1 `scripts/_common.sh` 内嵌 Python 片段统一使用 `python3 -X utf8 -`。
- [ ] 2.2 语法检查：`bash -n scripts/run.sh scripts/ui.sh scripts/_common.sh`。

## 3. 文档同步（Phase55.3）
- [ ] 3.1 更新 `helloagents/modules/rollout_sidecar.md`：补充 SSE `id:` 与 `Last-Event-ID` 断线补齐策略说明（与代码一致）。
- [ ] 3.2 更新 `helloagents/CHANGELOG.md` 记录 Phase55。

## 4. 收尾与归档（Phase55.4）
- [ ] 4.1 质量验证：`python3 -m compileall -q codex_sidecar`、`python3 -m unittest discover -s tests`。
- [ ] 4.2 将本方案包迁移至 `helloagents/archive/2026-01/` 并更新 `helloagents/archive/_index.md`。

