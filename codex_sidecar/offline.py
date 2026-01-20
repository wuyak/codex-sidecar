import hashlib
import json
from pathlib import Path
from typing import Any, Dict, List, Optional

from .watch.rollout_extract import extract_rollout_items
from .watch.rollout_paths import _ROLLOUT_RE, _latest_rollout_files, _parse_thread_id_from_filename


def _sha1_hex(s: str) -> str:
    return hashlib.sha1(s.encode("utf-8", errors="replace")).hexdigest()


def _norm_rel(rel: str) -> str:
    s = str(rel or "").strip().replace("\\", "/")
    # avoid accidental absolute paths
    while s.startswith("/"):
        s = s[1:]
    return s


def resolve_offline_rollout_path(codex_home: Path, rel: str) -> Optional[Path]:
    """
    Resolve a user-provided relative path to a rollout-*.jsonl under CODEX_HOME/sessions.

    Security constraints:
    - Must be inside CODEX_HOME/sessions
    - Must match rollout filename regex
    - Must be a file
    """
    try:
        base = Path(str(codex_home or "")).expanduser()
    except Exception:
        return None
    rel_s = _norm_rel(rel)
    if not rel_s:
        return None
    # Require sessions/ prefix to avoid reading arbitrary files.
    if not rel_s.startswith("sessions/"):
        return None
    try:
        sessions = (base / "sessions").resolve()
    except Exception:
        sessions = base / "sessions"
    try:
        cand = (base / rel_s).resolve()
    except Exception:
        cand = base / rel_s
    try:
        if not (cand == sessions or sessions in cand.parents):
            return None
    except Exception:
        return None
    try:
        if not cand.exists() or not cand.is_file():
            return None
    except Exception:
        return None
    try:
        if not _ROLLOUT_RE.match(cand.name):
            return None
    except Exception:
        return None
    return cand


def list_offline_rollout_files(codex_home: Path, limit: int = 60) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    try:
        base = Path(str(codex_home or "")).expanduser()
    except Exception:
        return out
    try:
        xs = _latest_rollout_files(base, limit=max(0, int(limit or 0)))
    except Exception:
        xs = []
    for p in xs:
        if not p:
            continue
        try:
            if not p.exists() or not p.is_file():
                continue
        except Exception:
            continue
        try:
            if not _ROLLOUT_RE.match(p.name):
                continue
        except Exception:
            continue
        rel = ""
        try:
            rel = str(p.relative_to(base)).replace("\\", "/")
        except Exception:
            # best-effort: still return something usable for display
            rel = f"sessions/{p.name}"
        tid = ""
        try:
            tid = str(_parse_thread_id_from_filename(p) or "")
        except Exception:
            tid = ""
        st = {}
        try:
            st = p.stat()
        except Exception:
            st = {}
        out.append(
            {
                "rel": _norm_rel(rel),
                "file": str(p),
                "thread_id": tid,
                "mtime": float(getattr(st, "st_mtime", 0.0) or 0.0),
                "size": int(getattr(st, "st_size", 0) or 0),
            }
        )
    return out


def read_tail_lines(path: Path, last_lines: int, max_bytes: int = 32 * 1024 * 1024) -> List[bytes]:
    """
    Read last N lines from a file (best-effort), bounded by max_bytes.

    Mirrors the behavior in watcher._read_tail_lines, but is self-contained so offline APIs
    do not depend on a running watcher instance.
    """
    try:
        size = path.stat().st_size
    except Exception:
        return []
    if size == 0:
        return []
    block = 256 * 1024
    want = max(1, int(last_lines) + 1)
    buf = b""
    read_bytes = 0
    pos = int(size)
    while pos > 0 and buf.count(b"\n") < want and read_bytes < int(max_bytes):
        step = block if pos >= block else pos
        pos -= step
        try:
            with path.open("rb") as f:
                f.seek(pos)
                chunk = f.read(step)
        except Exception:
            break
        buf = chunk + buf
        read_bytes += len(chunk)
    lines = buf.splitlines()
    if pos != 0 and lines:
        lines = lines[1:]
    ll = int(last_lines)
    if ll <= 0:
        return lines
    return lines[-ll:]


def build_offline_messages(
    *,
    rel: str,
    file_path: Path,
    tail_lines: int,
    offline_key: str,
) -> List[Dict[str, Any]]:
    """
    Parse rollout-*.jsonl into the same message schema as /api/messages.
    """
    rel_s = _norm_rel(rel)
    try:
        tid = str(_parse_thread_id_from_filename(file_path) or "")
    except Exception:
        tid = ""
    tail = read_tail_lines(file_path, last_lines=max(0, int(tail_lines or 0)))
    msgs: List[Dict[str, Any]] = []
    seq = 1
    line_no = 0
    for bline in tail:
        line_no += 1
        if not bline:
            continue
        try:
            obj = json.loads(bline.decode("utf-8", errors="replace"))
        except Exception:
            continue
        ts, extracted = extract_rollout_items(obj)
        for item in extracted:
            try:
                kind = str(item.get("kind") or "")
                text = str(item.get("text") or "")
            except Exception:
                continue
            hid = _sha1_hex(f"offline:{rel_s}:{kind}:{ts}:{text}")
            mid = hid[:16]
            msgs.append(
                {
                    "id": mid,
                    "seq": int(seq),
                    "ts": str(ts or ""),
                    "kind": kind,
                    "text": text,
                    "zh": "",
                    "translate_error": "",
                    "replay": True,
                    "key": str(offline_key or ""),
                    "thread_id": tid,
                    "file": str(file_path),
                    "line": int(line_no),
                }
            )
            seq += 1
    return msgs
