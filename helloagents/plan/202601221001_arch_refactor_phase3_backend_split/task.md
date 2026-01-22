# 任务清单: 后端架构分层优化（Phase 3）

目录: `helloagents/plan/202601221001_arch_refactor_phase3_backend_split/`

---

## 1. Watch 分层拆分（rollout_watcher）
- [√] 1.1 拆出“去重缓存”与“sha1 工具”到 `codex_sidecar/watch/` 子模块，保持 TUI gate 与 rollout 去重语义一致
- [√] 1.2 拆出“rollout 行解析/ingest/工具门禁提示/翻译入队”到独立模块，保持消息字段与去重 key 不变
- [√] 1.3 拆出“文件 tail/replay/poll”到独立模块，保持 offset/line_no 行为不变

## 2. Controller 分层拆分（可选，视风险）
- [ ] 2.1 将 `translate_probe/translate_text/translate_items` 抽为独立 helper（不改对外 API），并保持测试可 patch 的入口策略不变

## 3. 安全检查
- [ ] 3.1 执行安全检查（按G9: 输入验证、敏感信息处理、权限控制、EHRB风险规避）

## 4. 文档更新
- [ ] 4.1 更新 `helloagents/wiki/modules/rollout_sidecar.md`（记录本轮拆分点与模块边界）
- [ ] 4.2 更新 `helloagents/CHANGELOG.md` 与 `helloagents/history/index.md`

## 5. 测试
- [√] 5.1 运行单测：`python3 -m unittest discover -s tests`
- [√] 5.2 运行编译检查：`python3 -m compileall -q codex_sidecar`
