from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable, List, Optional, Set, Tuple


@dataclass(frozen=True)
class NormalizedFollow:
    mode: str
    thread_id: str
    file: str


def normalize_follow_mode(mode: str) -> str:
    m = str(mode or "").strip().lower()
    if m not in ("auto", "pin"):
        return "auto"
    return m


def normalize_follow_fields(*, thread_id: str, file: str) -> Tuple[str, str]:
    tid = str(thread_id or "").strip()
    fp = str(file or "").strip()
    return tid, fp


def normalize_follow(mode: str, *, thread_id: str, file: str) -> NormalizedFollow:
    m = normalize_follow_mode(mode)
    tid, fp = normalize_follow_fields(thread_id=thread_id, file=file)
    return NormalizedFollow(mode=m, thread_id=tid, file=fp)


def clean_exclude_keys_like(keys: Iterable[object], *, max_items: int, max_len: int) -> Set[str]:
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


def normalize_follow_excludes(
    *,
    keys: Optional[List[object]] = None,
    files: Optional[List[object]] = None,
    max_items: int = 1000,
    max_key_len: int = 256,
    max_file_len: int = 2048,
) -> Tuple[Set[str], Set[str]]:
    raw_keys = keys if isinstance(keys, list) else []
    raw_files = files if isinstance(files, list) else []
    cleaned_keys = clean_exclude_keys_like(raw_keys, max_items=max_items, max_len=max_key_len)
    cleaned_files = clean_exclude_keys_like(raw_files, max_items=max_items, max_len=max_file_len)
    return cleaned_keys, cleaned_files


def apply_follow_to_watcher(watcher: object, follow: NormalizedFollow) -> None:
    """
    Best-effort apply follow settings to a watcher.

    Note:
    - This helper intentionally does not check watcher thread liveness; the controller decides when to call it.
    """
    try:
        fn = getattr(watcher, "set_follow", None)
        if callable(fn):
            fn(follow.mode, thread_id=follow.thread_id, file=follow.file)
    except Exception:
        return


def apply_follow_excludes_to_watcher(watcher: object, *, keys: Set[str], files: Set[str]) -> None:
    """
    Best-effort apply follow excludes to a watcher.

    Note:
    - The watcher will perform its own strict file validation (sessions/** + rollout pattern); controller only trims/limits strings.
    """
    try:
        fn = getattr(watcher, "set_follow_excludes", None)
        if callable(fn):
            fn(keys=list(keys), files=list(files))
    except Exception:
        return

