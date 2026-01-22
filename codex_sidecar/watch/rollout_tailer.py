from pathlib import Path
from typing import Callable, List, Optional


def replay_tail(
    cur,
    *,
    last_lines: int,
    read_tail_lines: Callable[..., List[bytes]],
    stop_requested: Callable[[], bool],
    on_line: Callable[..., int],
) -> None:
    """
    从文件末尾回放最后 N 行。

    注意：
    - 这里的 cur.line_no 是“已处理行计数”，并非真实文件行号（沿用旧语义）。
    - cur.offset 的设置由调用方处理（通常已 seek 到文件末尾）。
    """
    replay_lines = max(0, int(last_lines))
    if replay_lines == 0:
        return
    try:
        tail = read_tail_lines(Path(cur.path), last_lines=replay_lines)
    except Exception:
        return
    for bline in tail:
        if stop_requested():
            break
        try:
            cur.line_no += 1
        except Exception:
            pass
        on_line(
            bline,
            file_path=Path(cur.path),
            line_no=int(getattr(cur, "line_no", 0) or 0),
            is_replay=True,
            thread_id=str(getattr(cur, "thread_id", "") or ""),
        )


def poll_one(
    cur,
    *,
    stop_requested: Callable[[], bool],
    on_line: Callable[..., int],
    on_primary_progress: Optional[Callable[[int, int], None]] = None,
    on_error: Optional[Callable[[], None]] = None,
) -> None:
    """
    从 cur.offset 开始读取增量内容，逐行回调 on_line。

    - cur.offset / cur.line_no 会被就地更新
    - 如提供 on_primary_progress，将在每行更新后回调（用于同步 watcher 的 primary 状态）
    """
    path = Path(cur.path)
    try:
        size = int(path.stat().st_size)
    except Exception:
        return
    if size <= 0:
        return
    try:
        if int(getattr(cur, "offset", 0) or 0) > size:
            cur.offset = 0
    except Exception:
        try:
            cur.offset = 0
        except Exception:
            pass
    try:
        if int(getattr(cur, "offset", 0) or 0) == size:
            return
    except Exception:
        pass

    try:
        with path.open("rb") as f:
            f.seek(int(getattr(cur, "offset", 0) or 0))
            while True:
                if stop_requested():
                    break
                bline = f.readline()
                if not bline:
                    break
                try:
                    cur.offset = int(f.tell())
                except Exception:
                    pass
                try:
                    cur.line_no += 1
                except Exception:
                    pass
                if on_primary_progress is not None:
                    try:
                        on_primary_progress(int(getattr(cur, "offset", 0) or 0), int(getattr(cur, "line_no", 0) or 0))
                    except Exception:
                        pass
                on_line(
                    bline.rstrip(b"\n"),
                    file_path=path,
                    line_no=int(getattr(cur, "line_no", 0) or 0),
                    is_replay=False,
                    thread_id=str(getattr(cur, "thread_id", "") or ""),
                )
    except Exception:
        if on_error is not None:
            try:
                on_error()
            except Exception:
                pass
        return
