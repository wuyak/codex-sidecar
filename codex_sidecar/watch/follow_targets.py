from pathlib import Path
from typing import Callable, List, Optional, Set


def is_excluded(
    p: Optional[Path],
    *,
    exclude_keys: Set[str],
    exclude_files: Set[Path],
    parse_thread_id: Callable[[Path], str],
) -> bool:
    if p is None:
        return False
    try:
        if p in exclude_files:
            return True
    except Exception:
        pass
    try:
        tid0 = str(parse_thread_id(p) or "").strip()
        if tid0 and tid0 in exclude_keys:
            return True
    except Exception:
        pass
    try:
        if str(p) in exclude_keys:
            return True
    except Exception:
        pass
    return False


def compute_follow_targets(
    *,
    selection_mode: str,
    watch_max_sessions: int,
    follow_mode: str,
    picked: Optional[Path],
    process_files: List[Path],
    codex_home: Path,
    latest_rollout_files: Callable[..., List[Path]],
    exclude_keys: Set[str],
    exclude_files: Set[Path],
    parse_thread_id: Callable[[Path], str],
) -> List[Path]:
    """
    计算最终需要跟随的 rollout 文件列表（不修改 watcher 状态）。

    注意：
    - 该函数不处理 `idle/wait_codex/wait_rollout` 等“明确不跟随任何文件”的状态；
      这些状态应由调用方提前短路。
    - 逻辑保持与历史 `_sync_follow_targets` 等价。
    """
    n = max(1, int(watch_max_sessions or 1))
    sel = str(selection_mode or "auto").strip().lower()
    fm = str(follow_mode or "")

    def _is_excluded(p: Optional[Path]) -> bool:
        return is_excluded(p, exclude_keys=exclude_keys, exclude_files=exclude_files, parse_thread_id=parse_thread_id)

    targets: List[Path] = []

    # Process-follow mode: only follow rollout files actually opened by Codex processes.
    # Do NOT scan sessions/** to "fill to N" (more stable + cheaper).
    if fm == "process":
        try:
            for p in list(process_files or []):
                if len(targets) >= n:
                    break
                if _is_excluded(p):
                    continue
                targets.append(p)
        except Exception:
            targets = []
        return targets

    if picked is not None and (not _is_excluded(picked)):
        targets.append(picked)

    if len(targets) < n:
        # Pin mode: never backfill from sessions/** by mtime (prevents zombie sessions).
        if sel == "pin":
            try:
                for p in list(process_files or []):
                    if len(targets) >= n:
                        break
                    if _is_excluded(p):
                        continue
                    if p in targets:
                        continue
                    targets.append(p)
            except Exception:
                pass
        else:
            try:
                # 进程跟随模式下，只跟随“进程正在写入的 rollout 文件”，不再扫描 sessions 补齐 N 个会话。
                # 否则重启/空窗期会误跟到历史会话（例如旧的 how 会话）。
                cands = []
                if fm != "process":
                    cands = latest_rollout_files(codex_home, limit=max(n * 3, n))
            except Exception:
                cands = []
            for p in cands:
                if len(targets) >= n:
                    break
                if _is_excluded(p):
                    continue
                if p in targets:
                    continue
                targets.append(p)

    return targets

