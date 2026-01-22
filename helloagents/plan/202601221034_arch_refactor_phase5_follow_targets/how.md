# 技术设计: Watch Follow 目标计算解耦（Phase 5）

## 技术方案
- 抽离纯逻辑函数：
  - `is_excluded(path, exclude_keys, exclude_files, parse_thread_id)`：统一排除判断
  - `compute_follow_targets(...)`：在给定 pick 与配置下产出 targets（不直接修改 watcher 状态）
- watcher 仍负责：
  - 读取/写回运行态字段（`_follow_files/_cursors/_current_file/...`）
  - replay/poll 调度与 ingestion

## 测试
- 新增 `tests/test_follow_targets.py` 覆盖三种模式：
  - `follow_mode=process` 仅跟随 process_files
  - `selection_mode=pin` 不从 sessions mtime 回填（避免 zombie sessions）
  - `selection_mode=auto` 允许从 sessions 最新列表回填并去重/排除

## 验证
- `python3 -m compileall -q codex_sidecar`
- `python3 -m unittest discover -s tests`

