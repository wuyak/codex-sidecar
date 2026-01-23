import time
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Dict, List, Optional, Sequence, Tuple


def apply_follow_targets(
    *,
    targets: List[Path],
    cursors: Dict[Path, object],
    new_cursor: Callable[..., object],
    now: float,
    replay_last_lines: int,
    read_tail_lines: Callable[..., List[bytes]],
    replay_tail: Callable[..., None],
    stop_requested: Callable[[], bool],
    on_line: Callable[..., int],
    parse_thread_id: Callable[[Path], str],
    prev_primary_offset: int,
    prev_primary_line_no: int,
) -> Tuple[Optional[Path], Optional[str], int, int]:
    """
    Apply selected follow targets to the cursor map in-place and derive primary status fields.

    This is a logic extraction from RolloutWatcher._sync_follow_targets(). Behavior should
    remain identical:
    - mark cursor.active based on targets
    - init new cursors once (seek to end + optional replay tail)
    - derive (current_file, thread_id, offset, line_no) for "primary"
    """
    keep = set(targets)
    # Keep the "touch active cursors" semantics aligned with previous implementation.
    for p, cur in list(cursors.items()):
        try:
            cur.active = p in keep  # type: ignore[attr-defined]
        except Exception:
            pass
        if p in keep:
            try:
                cur.last_active_ts = float(now)  # type: ignore[attr-defined]
            except Exception:
                pass

    for p in targets:
        cur = cursors.get(p)
        if cur is None:
            tid = ""
            try:
                tid = str(parse_thread_id(p) or "")
            except Exception:
                tid = ""
            try:
                cur = new_cursor(path=p, thread_id=tid)
            except Exception:
                # If we cannot construct a cursor, skip this target (best-effort).
                continue
            cursors[p] = cur
        try:
            cur.active = True  # type: ignore[attr-defined]
        except Exception:
            pass
        try:
            cur.last_active_ts = float(now)  # type: ignore[attr-defined]
        except Exception:
            pass

        inited = False
        try:
            inited = bool(getattr(cur, "inited", False))
        except Exception:
            inited = False
        if not inited:
            try:
                cur.inited = True  # type: ignore[attr-defined]
            except Exception:
                pass
            # Seek to end (follow only new writes), optionally replay last N lines.
            try:
                cur.offset = int(p.stat().st_size)  # type: ignore[attr-defined]
            except Exception:
                try:
                    cur.offset = 0  # type: ignore[attr-defined]
                except Exception:
                    pass
            if int(replay_last_lines or 0) > 0:
                replay_tail(
                    cur,
                    last_lines=int(replay_last_lines),
                    read_tail_lines=read_tail_lines,
                    stop_requested=stop_requested,
                    on_line=on_line,
                )

    current_file = targets[0] if targets else None
    thread_id = None
    if current_file is not None:
        try:
            thread_id = str(parse_thread_id(current_file) or "") or None
        except Exception:
            thread_id = None

    primary_offset = int(prev_primary_offset or 0)
    primary_line_no = int(prev_primary_line_no or 0)
    if current_file is not None:
        cur = cursors.get(current_file)
        if cur is not None:
            try:
                primary_offset = int(getattr(cur, "offset", 0) or 0)
                primary_line_no = int(getattr(cur, "line_no", 0) or 0)
            except Exception:
                primary_offset = int(prev_primary_offset or 0)
                primary_line_no = int(prev_primary_line_no or 0)

    return (current_file, thread_id, primary_offset, primary_line_no)


@dataclass(frozen=True)
class FollowApplyResult:
    follow_files: List[Path]
    current_file: Optional[Path]
    thread_id: Optional[str]
    offset: int
    line_no: int
    idle: bool


def apply_follow_sync_targets(
    *,
    idle: bool,
    targets: Sequence[Path],
    force: bool,
    prev_follow_files: Sequence[Path],
    cursors: Dict[Path, object],
    new_cursor: Callable[..., object],
    now: float,
    replay_last_lines: int,
    read_tail_lines: Callable[..., List[bytes]],
    replay_tail: Callable[..., None],
    stop_requested: Callable[[], bool],
    on_line: Callable[..., int],
    parse_thread_id: Callable[[Path], str],
    prev_primary_offset: int,
    prev_primary_line_no: int,
) -> Optional[FollowApplyResult]:
    """
    Apply follow sync plan targets to runtime state.

    This is extracted from RolloutWatcher._sync_follow_targets(). Behavior is intended
    to remain identical:
      - When idle, clear follow state only if force or previously following files.
      - When not idle, only apply when force or targets differ from previous list.
      - Delegate cursor init/primary derivation to apply_follow_targets().
    """
    prev_files = list(prev_follow_files or [])

    if bool(idle):
        if (not bool(force)) and (not prev_files):
            return None
        for cur in cursors.values():
            try:
                cur.active = False  # type: ignore[attr-defined]
            except Exception:
                pass
        return FollowApplyResult(
            follow_files=[],
            current_file=None,
            thread_id=None,
            offset=0,
            line_no=0,
            idle=True,
        )

    next_files = list(targets or [])
    if (not bool(force)) and (next_files == prev_files):
        return None

    cur_file, thread_id, primary_offset, primary_line_no = apply_follow_targets(
        targets=next_files,
        cursors=cursors,
        new_cursor=new_cursor,
        now=now,
        replay_last_lines=replay_last_lines,
        read_tail_lines=read_tail_lines,
        replay_tail=replay_tail,
        stop_requested=stop_requested,
        on_line=on_line,
        parse_thread_id=parse_thread_id,
        prev_primary_offset=prev_primary_offset,
        prev_primary_line_no=prev_primary_line_no,
    )
    return FollowApplyResult(
        follow_files=next_files,
        current_file=cur_file,
        thread_id=thread_id,
        offset=int(primary_offset or 0),
        line_no=int(primary_line_no or 0),
        idle=False,
    )


def now_ts() -> float:
    """
    A tiny indirection to make follow_state easier to unit-test deterministically.
    """
    try:
        return float(time.time())
    except Exception:
        return 0.0
