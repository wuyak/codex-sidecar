from __future__ import annotations

import threading
from typing import Optional


def request_stop_and_join(
    *,
    stop_event: Optional[threading.Event],
    thread: Optional[threading.Thread],
    join_timeout_s: float,
) -> bool:
    """
    Best-effort request a thread to stop and join for a bounded time.

    Returns:
      still_running: True if the thread is still alive after join attempt.
    """
    ev = stop_event
    t = thread
    if ev is not None:
        try:
            ev.set()
        except Exception:
            pass
    if t is not None and t.is_alive():
        try:
            t.join(timeout=float(join_timeout_s or 0.0))
        except Exception:
            pass
    return bool(t is not None and t.is_alive())

