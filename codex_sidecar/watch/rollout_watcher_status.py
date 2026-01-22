from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, Optional, Sequence


def build_watcher_status(
    *,
    current_file: Optional[Path],
    thread_id: str,
    offset: int,
    line_no: int,
    last_error: str,
    follow_mode: str,
    selection_mode: str,
    pinned_thread_id: str,
    pinned_file: str,
    watch_max_sessions: int,
    replay_last_lines: int,
    poll_interval_s: float,
    file_scan_interval_s: float,
    follow_files: Sequence[Path],
    codex_detected: bool,
    codex_pids: Sequence[int],
    codex_candidate_pids: Sequence[int],
    codex_process_regex: str,
    process_file: Optional[Path],
    process_files: Sequence[Path],
    translate_stats: Optional[Dict[str, Any]] = None,
) -> Dict[str, object]:
    """
    Build the RolloutWatcher status payload returned to the UI.

    Notes:
    - Keep field names and types stable for backwards-compat.
    - This function should be pure (no IO, no locks, no side-effects).
    """
    out: Dict[str, object] = {
        "current_file": str(current_file) if current_file is not None else "",
        "thread_id": str(thread_id or ""),
        "offset": str(int(offset or 0)),
        "line_no": str(int(line_no or 0)),
        "last_error": str(last_error or ""),
        "follow_mode": str(follow_mode or ""),
        "selection_mode": str(selection_mode or "auto"),
        "pinned_thread_id": str(pinned_thread_id or ""),
        "pinned_file": str(pinned_file or ""),
        "watch_max_sessions": str(int(watch_max_sessions or 0)),
        "replay_last_lines": str(int(replay_last_lines or 0)),
        "poll_interval_s": str(float(poll_interval_s or 0.0)),
        "file_scan_interval_s": str(float(file_scan_interval_s or 0.0)),
        "follow_files": [str(p) for p in (follow_files or [])][:12],
        "codex_detected": "1" if bool(codex_detected) else "0",
        "codex_pids": ",".join(str(x) for x in (list(codex_pids)[:8] if codex_pids is not None else [])),
        "codex_candidate_pids": ",".join(
            str(x) for x in (list(codex_candidate_pids)[:8] if codex_candidate_pids is not None else [])
        ),
        "codex_process_regex": str(codex_process_regex or ""),
        "process_file": str(process_file) if process_file is not None else "",
        "process_files": [str(p) for p in (process_files or [])][:12],
    }
    if isinstance(translate_stats, dict):
        out["translate"] = translate_stats
    return out

