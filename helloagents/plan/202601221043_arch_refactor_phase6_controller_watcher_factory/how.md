# 技术设计: Controller Watcher 构建解耦（Phase 6）

## 技术方案
- `control/watcher_factory.py` 提供一个小而明确的工厂函数：
  - 输入：`SidecarConfig`、`server_url`、translator 构建 callable、runtime follow 状态（pin/excludes）
  - 输出：`RolloutWatcher`
- `SidecarController.start()` 仍在锁内完成：
  - stop_event 创建
  - watcher 引用写入
  - watcher 线程启动

## 测试与验证
- `python3 -m compileall -q codex_sidecar`
- `python3 -m unittest discover -s tests`

