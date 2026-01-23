"""
Rollout watcher facade（向后兼容）。

核心实现已拆分到 `codex_sidecar.watch.rollout_watcher`，该文件仅保留旧导入路径：

  - from codex_sidecar.watcher import RolloutWatcher, HttpIngestClient
"""

from .watch.rollout_watcher import HttpIngestClient, RolloutWatcher

__all__ = [
    "HttpIngestClient",
    "RolloutWatcher",
]

