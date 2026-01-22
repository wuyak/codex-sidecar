# 任务清单：导入对话列表按年/月/日分级与补全

目录：`helloagents/plan/202601211103_offline_import_tree/`

---

## 1. 列表完整性
- [√] 1.1 导入对话拉取离线文件时使用 `limit=0`（展示全量历史文件，而非仅最近 N 个）

## 2. 分级与排序
- [√] 2.1 导入对话按 `sessions/YYYY/MM/DD` 年/月/日三层分级展示
- [√] 2.2 分组顺序按目录日期排序（不受 mtime/触碰文件影响）
- [√] 2.3 文件顺序按文件名时间戳排序（rollout-YYYY-MM-DDTHH-...）

## 3. 文档同步
- [√] 3.1 更新 `helloagents/modules/rollout_sidecar.md`
- [√] 3.2 更新 `helloagents/CHANGELOG.md`

## 4. 验证
- [√] 4.1 `python3 -m unittest discover -s tests -p 'test_*.py' -q`

