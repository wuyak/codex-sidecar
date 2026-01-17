import re
from pathlib import Path
from typing import List, Optional

_ROLLOUT_RE = re.compile(
    r"^rollout-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-([0-9a-fA-F-]{36})\.jsonl$"
)

def _latest_rollout_files(codex_home: Path, limit: int = 1) -> List[Path]:
    """
    List newest rollout files under CODEX_HOME/sessions by mtime (desc).

    Notes:
    - Windows/WSL may produce many files with identical mtimes; include name as a tiebreaker
      to keep ordering stable.
    """
    sessions = codex_home / "sessions"
    if not sessions.exists():
        return []
    globbed = list(sessions.glob("*/*/*/rollout-*.jsonl"))
    if not globbed:
        return []
    try:
        globbed.sort(key=lambda p: (p.stat().st_mtime, p.name), reverse=True)
    except Exception:
        globbed.sort(key=lambda p: p.name, reverse=True)
    n = int(limit or 0)
    if n <= 0:
        return globbed
    return globbed[:n]

def _latest_rollout_file(codex_home: Path) -> Optional[Path]:
    xs = _latest_rollout_files(codex_home, limit=1)
    return xs[0] if xs else None

def _parse_thread_id_from_filename(path: Path) -> Optional[str]:
    m = _ROLLOUT_RE.match(path.name)
    if not m:
        return None
    return m.group(1)

def _find_rollout_file_for_thread(codex_home: Path, thread_id: str) -> Optional[Path]:
    """
    Locate rollout file by thread_id (uuid) inside CODEX_HOME/sessions.
    """
    tid = str(thread_id or "").strip()
    if not tid:
        return None
    sessions = codex_home / "sessions"
    if not sessions.exists():
        return None
    # Layout: sessions/YYYY/MM/DD/rollout-...-{thread_id}.jsonl
    try:
        hits = list(sessions.glob(f"*/*/*/rollout-*-{tid}.jsonl"))
    except Exception:
        hits = []
    if not hits:
        return None
    try:
        hits.sort(key=lambda p: p.stat().st_mtime, reverse=True)
    except Exception:
        pass
    return hits[0]
