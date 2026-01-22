# 技术设计: Controller follow_excludes 清洗复用（Phase24）

## 技术方案
- 将 controller 侧的 `keys/files` 清洗统一复用 `clean_exclude_keys(iterable, max_items, max_len)`：
  - keys: `max_len=256`
  - files: `max_len=2048`
- watcher 侧仍保留更严格的文件路径校验（sessions/** + rollout filename），确保安全边界不变

## 测试与部署
- 新增 `tests/test_controller_follow_excludes.py` 覆盖：
  - keys/files 去空、截断、限量
  - controller 内部状态落地与返回 payload 一致

