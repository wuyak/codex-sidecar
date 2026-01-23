from pathlib import Path
from typing import Callable, Optional, Set

from ..config import SidecarConfig
from ..translator import Translator
from ..watcher import HttpIngestClient, RolloutWatcher


def build_rollout_watcher(
    *,
    cfg: SidecarConfig,
    server_url: str,
    build_translator: Callable[[SidecarConfig], Optional[Translator]],
    build_translator_fallback: Callable[[SidecarConfig], Translator],
    selection_mode: str,
    pinned_thread_id: str,
    pinned_file: str,
    exclude_keys: Set[str],
    exclude_files: Set[str],
) -> RolloutWatcher:
    """
    构建 RolloutWatcher 并注入运行态 follow 状态（pin/excludes）。

    设计目标：
    - 将 controller 中的“组装代码”抽离到 control 层，降低 controller_core 耦合与体积。
    - 保持对外行为不变（参数透传与 runtime follow 逻辑等价于历史实现）。
    """
    tr = None
    try:
        tr = build_translator(cfg)
    except Exception:
        tr = None
    if tr is None:
        tr = build_translator_fallback(cfg)

    w = RolloutWatcher(
        codex_home=Path(cfg.watch_codex_home).expanduser(),
        ingest=HttpIngestClient(server_url=str(server_url or "")),
        translator=tr,
        replay_last_lines=int(cfg.replay_last_lines),
        watch_max_sessions=int(getattr(cfg, "watch_max_sessions", 3) or 3),
        translate_mode=str(getattr(cfg, "translate_mode", "auto") or "auto"),
        poll_interval_s=float(cfg.poll_interval),
        file_scan_interval_s=float(cfg.file_scan_interval),
        follow_codex_process=bool(getattr(cfg, "follow_codex_process", False)),
        codex_process_regex=str(getattr(cfg, "codex_process_regex", "codex") or "codex"),
        only_follow_when_process=bool(getattr(cfg, "only_follow_when_process", True)),
    )
    try:
        w.set_follow(str(selection_mode or ""), thread_id=str(pinned_thread_id or ""), file=str(pinned_file or ""))
    except Exception:
        pass
    try:
        w.set_follow_excludes(keys=list(exclude_keys or set()), files=list(exclude_files or set()))
    except Exception:
        pass
    return w

