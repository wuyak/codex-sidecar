import os
from collections import deque
from pathlib import Path
from typing import Callable, Dict, Iterable, List, Optional, Pattern, Sequence, Set, Tuple

from .rollout_paths import _ROLLOUT_RE


def pid_matches_regex(
    pid: int,
    re_pat: Pattern[str],
    *,
    read_exe_basename: Callable[[int], str],
    read_argv0_basename: Callable[[int], str],
) -> bool:
    """
    判断 pid 是否匹配目标进程（强匹配：fullmatch basename）。

    说明：
    - 仅匹配 /proc/<pid>/exe basename 与 argv0 basename
    - 不回退到整条 cmdline 的弱匹配（避免“名字里带 codex”的非目标进程误入）
    """
    try:
        exe0 = read_exe_basename(pid)
        if exe0 and re_pat.fullmatch(exe0):
            return True
    except Exception:
        pass
    try:
        a0 = read_argv0_basename(pid)
        if a0 and re_pat.fullmatch(a0):
            return True
    except Exception:
        pass
    return False


def detect_processes(
    *,
    re_pat: Optional[Pattern[str]],
    list_pids: Callable[[], List[int]],
    read_exe_basename: Callable[[int], str],
    read_argv0_basename: Callable[[int], str],
    exclude_pid: Optional[int] = None,
    limit: int = 64,
) -> List[int]:
    """
    全量扫描 /proc 找到候选 PID（强匹配）。

    注意：
    - 调用方负责控制扫描频率（scan cadence），该函数只负责“当次扫描”的计算。
    """
    if re_pat is None:
        return []
    try:
        pids = list_pids()
    except Exception:
        return []
    out: List[int] = []
    lim = max(1, int(limit or 1))
    for pid0 in pids:
        try:
            pid = int(pid0)
        except Exception:
            continue
        if exclude_pid is not None:
            try:
                if int(exclude_pid) == pid:
                    continue
            except Exception:
                pass
        try:
            if pid_matches_regex(
                pid,
                re_pat,
                read_exe_basename=read_exe_basename,
                read_argv0_basename=read_argv0_basename,
            ):
                out.append(pid)
                if len(out) >= lim:
                    break
        except Exception:
            continue
    return out


def collect_process_tree(
    roots: Sequence[int],
    *,
    list_pids: Callable[[], List[int]],
    read_ppid: Callable[[int], Optional[int]],
) -> List[int]:
    """
    从 roots 出发收集完整进程树（包含子进程）。

    说明：
    - 通过一次性构建 PPID→children 映射来避免 N^2
    - /proc 读取失败时，至少返回 roots 本身
    """
    want: Set[int] = set()
    q = deque()
    for r in roots:
        try:
            pid = int(r)
        except Exception:
            continue
        want.add(pid)
        q.append(pid)

    try:
        pids = list_pids()
    except Exception:
        return sorted(want)
    children: Dict[int, List[int]] = {}
    for pid0 in pids:
        try:
            pid = int(pid0)
            ppid = read_ppid(pid)
            if ppid:
                children.setdefault(int(ppid), []).append(pid)
        except Exception:
            continue

    while q:
        pid = q.popleft()
        for child in children.get(pid, []):
            if child in want:
                continue
            want.add(child)
            q.append(child)
    return sorted(want)


def find_rollout_opened_by_pids(
    pids: Sequence[int],
    *,
    codex_home: Path,
    iter_fd_targets_with_flags: Callable[[int], Iterable[Tuple[str, int]]],
    limit: int = 12,
) -> Tuple[List[Path], List[int]]:
    """
    从进程 fd 列表中找出“正在写入”的 rollout-*.jsonl（按 mtime 降序）。

    返回：
      - files: rollout 文件（最多 limit 个）
      - openers: 打开这些文件的 pid 列表（去重 + 排序）
    """
    found_by_path: Dict[str, Path] = {}
    mtime_by_path: Dict[str, float] = {}
    openers_by_path: Dict[str, Set[int]] = {}

    try:
        root = codex_home.resolve()
    except Exception:
        root = codex_home

    for pid0 in pids:
        try:
            pid = int(pid0)
        except Exception:
            continue
        try:
            it = iter_fd_targets_with_flags(pid)
        except Exception:
            continue
        for target, flags in it:
            try:
                if not target or "sessions" not in target or "rollout-" not in target or not target.endswith(".jsonl"):
                    continue
                cand = Path(target)
                if not _ROLLOUT_RE.match(cand.name):
                    continue
                if not cand.exists() or not cand.is_file():
                    continue
                # Prefer rollout files that are actually being written by Codex.
                # Some processes may open historical sessions read-only; treat those as non-active.
                if isinstance(flags, int) and flags >= 0:
                    try:
                        accmode = int(flags) & int(getattr(os, "O_ACCMODE", 3))
                        if accmode not in (int(getattr(os, "O_WRONLY", 1)), int(getattr(os, "O_RDWR", 2))):
                            continue
                    except Exception:
                        pass
                # Keep it inside CODEX_HOME as much as possible (avoid false positives).
                try:
                    cand_r = cand.resolve()
                except Exception:
                    cand_r = cand
                try:
                    cand_r.relative_to(root)
                except Exception:
                    continue
                key = str(cand_r)
                if key not in found_by_path:
                    found_by_path[key] = cand_r
                    try:
                        mtime_by_path[key] = cand_r.stat().st_mtime
                    except Exception:
                        mtime_by_path[key] = 0.0
                openers_by_path.setdefault(key, set()).add(pid)
            except Exception:
                continue

    try:
        keys = sorted(found_by_path.keys(), key=lambda k: float(mtime_by_path.get(k, 0.0)), reverse=True)
    except Exception:
        keys = list(found_by_path.keys())
    lim = max(1, int(limit or 1))
    keys = keys[:lim]
    files = [found_by_path[k] for k in keys if k in found_by_path]

    openers: Set[int] = set()
    for k in keys:
        try:
            openers.update(openers_by_path.get(k, set()))
        except Exception:
            continue
    try:
        openers_list = sorted(openers)
    except Exception:
        openers_list = list(openers)
    return files, openers_list
