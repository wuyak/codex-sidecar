from __future__ import annotations

from typing import Callable, Optional

from ..config import SidecarConfig
from ..translator import Translator
from ..watcher import RolloutWatcher


def apply_watcher_hot_updates(
    *,
    watcher: Optional[RolloutWatcher],
    running: bool,
    cfg: Optional[SidecarConfig],
    prev_translate_mode: str,
    prev_provider: str,
    touched_translator: bool,
    build_translator: Callable[[SidecarConfig], Optional[Translator]],
    build_translator_fallback: Callable[[SidecarConfig], Translator],
) -> None:
    """
    Best-effort hot updates for a running watcher.

    This is extracted from SidecarController._apply_watcher_hot_updates to keep
    controller_core focused on lifecycle/locking concerns.

    Behavior is intended to be equivalent to the legacy inlined logic:
      - apply translate_mode change
      - rebuild translator on provider change or translator config touch
      - always apply runtime watcher settings that are safe to hot-update
    """
    if watcher is None or (not bool(running)) or cfg is None:
        return

    # Hot-apply translate_mode for the running watcher (no restart required).
    try:
        next_tm = str(getattr(cfg, "translate_mode", "auto") or "auto").strip().lower()
        if next_tm and next_tm != str(prev_translate_mode or ""):
            watcher.set_translate_mode(next_tm)
    except Exception:
        pass

    # Hot-reload translator/provider config for the running watcher.
    try:
        next_provider = str(getattr(cfg, "translator_provider", "") or "").strip().lower()
        if bool(touched_translator) or next_provider != str(prev_provider or ""):
            tr = None
            try:
                tr = build_translator(cfg)
            except Exception:
                tr = None
            if tr is None:
                tr = build_translator_fallback(cfg)
            watcher.set_translator(tr)
    except Exception:
        pass

    # Hot-apply watcher runtime settings where it's safe (no full restart required).
    # Note: watch_codex_home still requires stop/start to take effect.
    try:
        watcher.set_watch_max_sessions(int(getattr(cfg, "watch_max_sessions", 3) or 3))
        watcher.set_replay_last_lines(int(getattr(cfg, "replay_last_lines", 0) or 0))
        watcher.set_poll_interval_s(float(getattr(cfg, "poll_interval", 0.5) or 0.5))
        watcher.set_file_scan_interval_s(float(getattr(cfg, "file_scan_interval", 2.0) or 2.0))
        watcher.set_follow_picker_config(
            follow_codex_process=bool(getattr(cfg, "follow_codex_process", False)),
            codex_process_regex=str(getattr(cfg, "codex_process_regex", "codex") or "codex"),
            only_follow_when_process=bool(getattr(cfg, "only_follow_when_process", True)),
        )
    except Exception:
        pass

