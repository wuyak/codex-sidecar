from typing import Any, Callable, Dict, Optional, Tuple


def retranslate_one(
    mid: str,
    *,
    get_message: Callable[[str], Optional[dict]],
    clear_error: Callable[[str], None],
    resolve_watcher: Callable[[], Tuple[Optional[Any], bool]],
) -> Dict[str, Any]:
    """
    Force (re)translation for a single message id.

    This helper is controller-agnostic:
    - It receives state access as callables (get_message / clear_error).
    - It resolves watcher/running lazily (after message validation).
    """
    m = str(mid or "").strip()
    if not m:
        return {"ok": False, "error": "missing_id"}

    try:
        msg = get_message(m)
    except Exception:
        msg = None
    if not isinstance(msg, dict):
        return {"ok": False, "error": "not_found"}

    kind = str(msg.get("kind") or "")
    if kind != "reasoning_summary":
        return {"ok": False, "error": "not_thinking"}

    text = str(msg.get("text") or "")
    if not text.strip():
        return {"ok": False, "error": "empty_text"}

    prev_zh = str(msg.get("zh") or "")
    thread_id = str(msg.get("thread_id") or "")
    file_path = str(msg.get("file") or "")
    thread_key = thread_id or file_path or "unknown"

    watcher = None
    running = False
    try:
        watcher, running = resolve_watcher()
    except Exception:
        watcher, running = None, False
    if watcher is None or not running:
        return {"ok": False, "error": "not_running"}

    queued = False
    try:
        queued = bool(watcher.retranslate(m, text=text, thread_key=thread_key, fallback_zh=prev_zh))
    except Exception:
        queued = False
    if not queued:
        return {"ok": False, "id": m, "queued": False, "error": "enqueue_failed"}

    # Clear existing error (but keep previous zh until the new translation succeeds).
    try:
        clear_error(m)
    except Exception:
        pass
    return {"ok": True, "id": m, "queued": True}

