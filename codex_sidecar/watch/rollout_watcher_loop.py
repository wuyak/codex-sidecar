from __future__ import annotations

from typing import Optional


def should_poll_tui(
    *,
    follow_mode: str,
    codex_detected: bool,
    now_ts: float,
    last_poll_ts: float,
    file_scan_interval_s: float,
) -> bool:
    """
    Decide whether RolloutWatcher should poll codex-tui.log in the current loop tick.

    Behavior is intentionally kept equivalent to the legacy inlined logic in
    RolloutWatcher.run():
      - When follow_mode is idle/wait_codex AND no Codex process is detected,
        throttle TUI polling down to the scan cadence (file_scan_interval_s).
      - Otherwise, poll at the normal cadence (i.e. always poll each tick).
    """
    mode = str(follow_mode or "").strip().lower()
    if mode in ("idle", "wait_codex") and (not bool(codex_detected)):
        try:
            last = float(last_poll_ts or 0.0)
        except Exception:
            last = 0.0
        try:
            scan = float(file_scan_interval_s or 0.0)
        except Exception:
            scan = 0.0
        if scan > 0.0:
            try:
                now = float(now_ts or 0.0)
            except Exception:
                now = 0.0
            if (now - last) < scan:
                return False
    return True


def decide_follow_sync_force(
    *,
    force_switch: bool,
    now_ts: float,
    last_scan_ts: float,
    file_scan_interval_s: float,
) -> Optional[bool]:
    """
    Decide whether to sync follow targets in this tick, and whether it should be forced.

    Returns:
      - True  : do sync with force=True  (e.g. UI follow_dirty)
      - False : do sync with force=False (scan cadence)
      - None  : do not sync in this tick

    Intended to mirror the legacy inlined run-loop logic exactly:
      if force_switch: sync(force=True)
      elif now - last_scan >= file_scan_interval_s: sync(force=False)
    """
    if bool(force_switch):
        return True
    try:
        now = float(now_ts or 0.0)
    except Exception:
        now = 0.0
    try:
        last = float(last_scan_ts or 0.0)
    except Exception:
        last = 0.0
    try:
        scan = float(file_scan_interval_s or 0.0)
    except Exception:
        scan = 0.0
    if (now - last) >= scan:
        return False
    return None
