import json
from pathlib import Path
from typing import Any, Dict, Optional


def read_session_meta_source(file_path: Path, *, max_lines: int = 24) -> Optional[Any]:
    """
    Read rollout JSONL header and extract session_meta.payload.source (best-effort).

    Notes:
    - Watchers often tail only the last N lines and may miss the first session_meta line.
      This helper reads only the first few lines to recover parent/subagent metadata.
    - Returns the raw "source" value (string or dict) when found, else None.
    """
    try:
        n = int(max_lines or 0)
    except Exception:
        n = 24
    n = max(1, min(200, n))

    try:
        with file_path.open("rb") as f:
            for _ in range(n):
                bline = f.readline()
                if not bline:
                    break
                try:
                    obj = json.loads(bline.decode("utf-8", errors="replace"))
                except Exception:
                    continue
                if not isinstance(obj, dict):
                    continue
                if obj.get("type") != "session_meta":
                    continue
                payload = obj.get("payload")
                if not isinstance(payload, dict):
                    continue
                return payload.get("source")
    except Exception:
        return None
    return None


def normalize_session_source_meta(source: Any) -> Dict[str, Any]:
    """
    Normalize Codex rollout session_meta.payload.source into stable UI fields.

    Output keys:
      - source_kind: "cli" | "subagent" | other string
      - parent_thread_id: only for subagent
      - subagent_depth: only for subagent
    """
    if isinstance(source, str):
        s = str(source or "").strip()
        if not s:
            return {}
        return {"source_kind": s.lower()}

    if isinstance(source, dict):
        sub = source.get("subagent")
        if not isinstance(sub, dict):
            return {}
        spawn = sub.get("thread_spawn")
        if not isinstance(spawn, dict):
            return {}
        parent = spawn.get("parent_thread_id")
        if not isinstance(parent, str) or not parent.strip():
            return {}

        out: Dict[str, Any] = {"source_kind": "subagent", "parent_thread_id": parent.strip()}

        depth = spawn.get("depth")
        if isinstance(depth, int):
            out["subagent_depth"] = int(depth)
        elif isinstance(depth, str):
            ds = depth.strip()
            if ds.isdigit():
                out["subagent_depth"] = int(ds)
        return out

    return {}


def read_session_source_meta(file_path: Path, *, max_lines: int = 24) -> Dict[str, Any]:
    """
    Convenience wrapper: read + normalize.
    """
    src = read_session_meta_source(file_path, max_lines=max_lines)
    return normalize_session_source_meta(src)

