import os
from pathlib import Path
from typing import Iterable, List, Optional, Set, Tuple

_PROC_ROOT = Path("/proc")

def _proc_read_exe(pid: int) -> str:
    """
    Read the process executable path via /proc/<pid>/exe symlink.
    """
    try:
        return os.readlink(str(_PROC_ROOT / str(pid) / "exe"))
    except Exception:
        return ""

def _proc_read_exe_basename(pid: int) -> str:
    try:
        p = _proc_read_exe(pid)
        return Path(p).name if p else ""
    except Exception:
        return ""

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

def _proc_read_argv0(pid: int, max_bytes: int = 64 * 1024) -> str:
    """
    Read argv[0] (first element) from /proc/<pid>/cmdline.
    """
    try:
        raw = (_PROC_ROOT / str(pid) / "cmdline").read_bytes()
    except Exception:
        return ""
    if not raw:
        return ""
    if len(raw) > max_bytes:
        raw = raw[:max_bytes]
    try:
        first = raw.split(b"\x00", 1)[0]
    except Exception:
        first = raw
    if not first:
        return ""
    try:
        return first.decode("utf-8", errors="replace")
    except Exception:
        return ""

def _proc_read_argv0_basename(pid: int) -> str:
    try:
        a0 = _proc_read_argv0(pid)
        return Path(a0).name if a0 else ""
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

def _proc_read_fd_flags(pid: int, fd: str) -> int:
    """
    Read fd open flags via /proc/<pid>/fdinfo/<fd>.

    Returns:
      - flags as an int (when available)
      - -1 on failure
    """
    try:
        txt = (_PROC_ROOT / str(pid) / "fdinfo" / str(fd)).read_text(encoding="utf-8", errors="replace")
    except Exception:
        return -1
    for line in txt.splitlines():
        if line.startswith("flags:"):
            v = (line.split(":", 1)[1] or "").strip()
            try:
                # fdinfo flags are printed in octal (e.g. 0100002)
                return int(v, 8)
            except Exception:
                return -1
    return -1

def _proc_iter_fd_targets_with_flags(pid: int) -> Iterable[Tuple[str, int]]:
    """
    Iterate (target_path, flags) for /proc/<pid>/fd entries.

    flags = -1 when fdinfo is unavailable.
    """
    fd_dir = _PROC_ROOT / str(pid) / "fd"
    try:
        entries = os.listdir(str(fd_dir))
    except Exception:
        return []
    out: List[Tuple[str, int]] = []
    for ent in entries:
        p = fd_dir / ent
        try:
            target = os.readlink(str(p))
        except Exception:
            continue
        if target.endswith(" (deleted)"):
            target = target[: -len(" (deleted)")]
        flags = _proc_read_fd_flags(pid, ent)
        out.append((target, flags))
    return out
