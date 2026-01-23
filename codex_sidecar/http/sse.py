from typing import Optional, Tuple

from .json_helpers import json_bytes


def parse_last_event_id(headers) -> Optional[int]:
    """
    Parse SSE resume cursor from EventSource.

    Notes:
    - Browsers send `Last-Event-ID` on reconnect only after the server has
      emitted at least one `id:` field in the event stream.
    - We intentionally treat "missing header" as "no resume" to avoid
      replaying history on first connect (UI fetches history via /api/messages).
    """
    try:
        raw = headers.get("Last-Event-ID")
    except Exception:
        raw = None
    if not raw:
        return None
    s = str(raw or "").strip()
    if not s:
        return None
    try:
        n = int(s)
    except Exception:
        return None
    return max(0, n)


def sse_message_event_bytes(msg: dict) -> Tuple[Optional[bytes], bytes]:
    """
    Build an SSE "message" event.

    Returns:
      (id_line_bytes_or_none, body_bytes)
    """
    op = ""
    try:
        op = str(msg.get("op") or "").strip().lower()
    except Exception:
        op = ""

    # Only attach `id:` for non-update events.
    # Updates can arrive for older messages (e.g. translation backfill); if we
    # used the message `seq` as the SSE id for updates, browsers may "rewind"
    # Last-Event-ID and cause duplicate replays on reconnect.
    id_line: Optional[bytes] = None
    if op != "update":
        try:
            seq = int(msg.get("seq") or 0)
        except Exception:
            seq = 0
        if seq > 0:
            id_line = f"id: {seq}\n".encode("utf-8")

    data = json_bytes(msg)
    out = b"event: message\n" + b"data: " + data + b"\n\n"
    return id_line, out

