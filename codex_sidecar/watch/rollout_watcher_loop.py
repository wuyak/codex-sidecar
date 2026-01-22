from __future__ import annotations


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

