from pathlib import Path
from typing import Callable, Iterable, Optional, Pattern, Set


def resolve_pinned_rollout_file(
    codex_home: Path,
    *,
    file_path: str,
    thread_id: str,
    find_rollout_file_for_thread: Callable[[Path, str], Optional[Path]],
    rollout_re: Pattern[str],
) -> Optional[Path]:
    """
    Resolve a pinned rollout file for follow=pin mode.

    Behavior is kept consistent with the legacy RolloutWatcher.set_follow:
    - file_path can be absolute or CODEX_HOME-relative.
    - Only accept files under CODEX_HOME/sessions/** and matching rollout filename pattern.
    - If file_path is invalid/missing/outside sessions_root, fall back to thread_id lookup.
    """
    fp = str(file_path or "").strip()
    tid = str(thread_id or "").strip()

    pinned: Optional[Path] = None
    if fp:
        try:
            cand = Path(fp).expanduser()
            if not cand.is_absolute():
                cand = (codex_home / cand).resolve()
            else:
                cand = cand.resolve()
            sessions_root = (codex_home / "sessions").resolve()
            try:
                _ = cand.relative_to(sessions_root)
            except Exception:
                cand = None  # type: ignore[assignment]
            if cand is not None and cand.exists() and cand.is_file() and rollout_re.match(cand.name):
                pinned = cand
        except Exception:
            pinned = None

    if pinned is None and tid:
        try:
            pinned = find_rollout_file_for_thread(codex_home, tid)
        except Exception:
            pinned = None
    return pinned


def clean_exclude_keys(keys: Iterable[object], *, max_items: int = 1000, max_len: int = 256) -> Set[str]:
    cleaned: Set[str] = set()
    lim = max(1, int(max_items or 1))
    mlen = max(8, int(max_len or 8))
    for x in keys:
        try:
            s = str(x or "").strip()
        except Exception:
            s = ""
        if not s:
            continue
        cleaned.add(s[:mlen])
        if len(cleaned) >= lim:
            break
    return cleaned


def clean_exclude_files(
    files: Iterable[object],
    *,
    codex_home: Path,
    rollout_re: Pattern[str],
    max_items: int = 1000,
) -> Set[Path]:
    cleaned: Set[Path] = set()
    lim = max(1, int(max_items or 1))
    sessions_root = (codex_home / "sessions").resolve()
    for x in files:
        try:
            s = str(x or "").strip()
        except Exception:
            s = ""
        if not s:
            continue
        try:
            cand = Path(s).expanduser()
            if not cand.is_absolute():
                cand = (codex_home / cand).resolve()
            else:
                cand = cand.resolve()
            try:
                _ = cand.relative_to(sessions_root)
            except Exception:
                continue
            if cand.exists() and cand.is_file() and rollout_re.match(cand.name):
                cleaned.add(cand)
        except Exception:
            continue
        if len(cleaned) >= lim:
            break
    return cleaned
