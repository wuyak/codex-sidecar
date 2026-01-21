from pathlib import Path
from typing import List


def read_tail_lines(path: Path, *, last_lines: int, max_bytes: int = 32 * 1024 * 1024) -> List[bytes]:
    """
    Read last N lines from a file (best-effort), bounded by max_bytes.

    Notes:
    - The caller should treat this as a heuristic helper. It is optimized for the sidecar's
      append-only JSONL files and log tails.
    - Behavior intentionally mirrors the previous watcher/offline implementations:
      when we start reading from a non-zero offset, we may drop the first partial line.
    """
    try:
        size = int(path.stat().st_size)
    except Exception:
        return []
    if size <= 0:
        return []

    block = 256 * 1024
    want = max(1, int(last_lines) + 1)
    read_bytes = 0
    pos = size
    chunks: List[bytes] = []
    nl = 0

    try:
        with path.open("rb") as f:
            while pos > 0 and nl < want and read_bytes < int(max_bytes):
                step = block if pos >= block else pos
                pos -= step
                f.seek(pos)
                chunk = f.read(step)
                if not chunk:
                    break
                chunks.append(chunk)
                read_bytes += len(chunk)
                nl += chunk.count(b"\n")
    except Exception:
        return []

    if not chunks:
        return []

    buf = b"".join(reversed(chunks))
    lines = buf.splitlines()
    if pos != 0 and lines:
        lines = lines[1:]
    ll = int(last_lines)
    if ll <= 0:
        return lines
    return lines[-ll:]

