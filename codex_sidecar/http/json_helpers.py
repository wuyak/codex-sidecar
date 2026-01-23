import json
from typing import Any, Dict, Optional, Tuple


def json_bytes(obj: dict) -> bytes:
    return json.dumps(obj, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def parse_json_object(raw: bytes, *, allow_invalid_json: bool) -> Tuple[Optional[Dict[str, Any]], str]:
    """
    Parse request body bytes as a JSON object.

    Returns: (obj, error)
    - obj: dict on success, or {} when allow_invalid_json=True and JSON is invalid
    - error: "" on success; otherwise "invalid_json" / "invalid_payload"
    """
    try:
        obj = json.loads(raw.decode("utf-8", errors="replace"))
    except Exception:
        if allow_invalid_json:
            obj = {}
        else:
            return None, "invalid_json"
    if not isinstance(obj, dict):
        return None, "invalid_payload"
    return obj, ""

