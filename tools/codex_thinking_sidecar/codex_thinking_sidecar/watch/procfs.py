import os
from pathlib import Path
from typing import Iterable, List, Set

_PROC_ROOT = Path("/proc")

def _proc_list_pids() -> List[int]:
    try:
        names = os.listdir(str(_PROC_ROOT))
    except Exception:
        return []
    out: List[int] = []
    for n in names:
        if not n.isdigit():
            continue
        try:
            out.append(int(n))
        except Exception:
            continue
    return out

def _proc_read_cmdline(pid: int, max_bytes: int = 64 * 1024) -> str:
    try:
        raw = (_PROC_ROOT / str(pid) / "cmdline").read_bytes()
    except Exception:
        return ""
    if not raw:
        return ""
    if len(raw) > max_bytes:
        raw = raw[:max_bytes]
    parts = [p for p in raw.split(b"\x00") if p]
    try:
        return " ".join(p.decode("utf-8", errors="replace") for p in parts)
    except Exception:
        return ""

def _proc_read_ppid(pid: int) -> Optional[int]:
    try:
        txt = (_PROC_ROOT / str(pid) / "status").read_text(encoding="utf-8", errors="replace")
    except Exception:
        return None
    for line in txt.splitlines():
        if line.startswith("PPid:"):
            v = (line.split(":", 1)[1] or "").strip()
            try:
                return int(v)
            except Exception:
                return None
    return None

def _proc_iter_fd_targets(pid: int) -> Iterable[str]:
    fd_dir = _PROC_ROOT / str(pid) / "fd"
    try:
        entries = os.listdir(str(fd_dir))
    except Exception:
        return []
    out: List[str] = []
    for ent in entries:
        p = fd_dir / ent
        try:
            target = os.readlink(str(p))
        except Exception:
            continue
        if target.endswith(" (deleted)"):
            target = target[: -len(" (deleted)")]
        out.append(target)
    return out
