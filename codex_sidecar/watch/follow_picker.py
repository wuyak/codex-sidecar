import os
import re
from collections import deque
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional, Pattern, Sequence, Set, Tuple

from .procfs import (
    _proc_iter_fd_targets_with_flags,
    _proc_list_pids,
    _proc_read_argv0_basename,
    _proc_read_cmdline,
    _proc_read_exe_basename,
    _proc_read_ppid,
)
from .rollout_paths import (
    _ROLLOUT_RE,
    _find_rollout_file_for_thread,
    _latest_rollout_file,
    _parse_thread_id_from_filename,
)


@dataclass
class FollowPick:
    picked: Optional[Path]
    thread_id: Optional[str]
    follow_mode: str
    codex_detected: bool
    # PIDs that actually opened rollout-*.jsonl (a tighter set than "candidates").
    codex_pids: List[int]
    process_file: Optional[Path]
    process_files: List[Path]
    # Candidate root PIDs matched by regex (debugging only).
    candidate_pids: List[int]


class FollowPicker:
    def __init__(
        self,
        codex_home: Path,
        *,
        follow_codex_process: bool,
        codex_process_regex: str,
        only_follow_when_process: bool,
    ) -> None:
        self._codex_home = codex_home
        self._follow_codex_process = bool(follow_codex_process)
        self._only_follow_when_process = bool(only_follow_when_process)
        self._codex_process_regex_raw = str(codex_process_regex or "codex")
        self._codex_process_re: Optional[Pattern[str]] = None
        try:
            self._codex_process_re = re.compile(self._codex_process_regex_raw, flags=re.IGNORECASE)
        except Exception:
            self._codex_process_re = None

    @property
    def codex_process_regex(self) -> str:
        return self._codex_process_regex_raw

    def pick(
        self,
        *,
        selection_mode: str,
        pinned_thread_id: str,
        pinned_file: Optional[Path],
    ) -> FollowPick:
        mode = str(selection_mode or "auto").strip().lower()
        if mode == "pin":
            return self._pick_pinned(pinned_thread_id=pinned_thread_id, pinned_file=pinned_file)
        return self._pick_auto()

    def _pick_pinned(self, *, pinned_thread_id: str, pinned_file: Optional[Path]) -> FollowPick:
        cand: Optional[Path] = None
        if pinned_file is not None:
            try:
                if pinned_file.exists() and pinned_file.is_file() and _ROLLOUT_RE.match(pinned_file.name):
                    cand = pinned_file
            except Exception:
                cand = None

        if cand is None:
            tid = str(pinned_thread_id or "").strip()
            if tid:
                cand = _find_rollout_file_for_thread(self._codex_home, tid)

        if cand is None:
            return FollowPick(
                picked=None,
                thread_id=None,
                follow_mode="pinned_missing",
                codex_detected=False,
                codex_pids=[],
                process_file=None,
                process_files=[],
                candidate_pids=[],
            )

        tid = _parse_thread_id_from_filename(cand)
        # Even in pinned mode, try to detect Codex process-follow targets so the watcher
        # can fill "parallel sessions" from the *current* process (avoids zombie tabs).
        codex_detected = False
        codex_pids: List[int] = []
        process_file: Optional[Path] = None
        process_files: List[Path] = []
        candidate_pids: List[int] = []
        follow_mode = "pinned"

        if self._follow_codex_process and self._codex_process_re is not None:
            pids = self._detect_codex_processes()
            candidate_pids = list(pids)
            codex_detected = bool(pids)
            if codex_detected:
                tree = self._collect_process_tree(pids)
                opened, openers = self._find_rollout_opened_by_pids(tree, limit=12)
                if opened:
                    process_file = opened[0]
                    process_files = opened
                    codex_pids = openers
                    follow_mode = "pinned_process"
                else:
                    follow_mode = "pinned_wait_rollout"

        return FollowPick(
            picked=cand,
            thread_id=tid,
            follow_mode=follow_mode,
            codex_detected=codex_detected,
            codex_pids=codex_pids,
            process_file=process_file,
            process_files=process_files,
            candidate_pids=candidate_pids,
        )

    def _pick_auto(self) -> FollowPick:
        if not self._follow_codex_process:
            picked = _latest_rollout_file(self._codex_home)
            return FollowPick(
                picked=picked,
                thread_id=_parse_thread_id_from_filename(picked) if picked is not None else None,
                follow_mode="legacy",
                codex_detected=False,
                codex_pids=[],
                process_file=None,
                process_files=[],
                candidate_pids=[],
            )

        if self._codex_process_re is None:
            if self._only_follow_when_process:
                return FollowPick(
                    picked=None,
                    thread_id=None,
                    follow_mode="wait_codex",
                    codex_detected=False,
                    codex_pids=[],
                    process_file=None,
                    process_files=[],
                    candidate_pids=[],
                )
            picked = _latest_rollout_file(self._codex_home)
            return FollowPick(
                picked=picked,
                thread_id=_parse_thread_id_from_filename(picked) if picked is not None else None,
                follow_mode="fallback",
                codex_detected=False,
                codex_pids=[],
                process_file=None,
                process_files=[],
                candidate_pids=[],
            )

        pids = self._detect_codex_processes()
        codex_detected = bool(pids)

        if not codex_detected:
            if self._only_follow_when_process:
                return FollowPick(
                    picked=None,
                    thread_id=None,
                    follow_mode="idle",
                    codex_detected=False,
                    codex_pids=[],
                    process_file=None,
                    process_files=[],
                    candidate_pids=[],
                )
            picked = _latest_rollout_file(self._codex_home)
            return FollowPick(
                picked=picked,
                thread_id=_parse_thread_id_from_filename(picked) if picked is not None else None,
                follow_mode="fallback",
                codex_detected=False,
                codex_pids=[],
                process_file=None,
                process_files=[],
                candidate_pids=[],
            )

        tree = self._collect_process_tree(pids)
        opened, openers = self._find_rollout_opened_by_pids(tree, limit=12)
        if opened:
            return FollowPick(
                picked=opened[0],
                thread_id=_parse_thread_id_from_filename(opened[0]),
                follow_mode="process",
                codex_detected=True,
                codex_pids=openers,
                process_file=opened[0],
                process_files=opened,
                candidate_pids=list(pids),
            )

        # Codex is running but we can't find an opened rollout yet.
        # In process-follow mode, prefer waiting rather than scanning sessions aggressively.
        return FollowPick(
            picked=None,
            thread_id=None,
            follow_mode="wait_rollout",
            codex_detected=True,
            codex_pids=[],
            process_file=None,
            process_files=[],
            candidate_pids=list(pids),
        )

    def _detect_codex_processes(self) -> List[int]:
        re_pat = self._codex_process_re
        if re_pat is None:
            return []
        strong: List[int] = []
        weak: List[int] = []
        my_pid = None
        try:
            my_pid = int(os.getpid())
        except Exception:
            my_pid = None
        try:
            pids = _proc_list_pids()
        except Exception:
            return []
        for pid in pids:
            if my_pid is not None and int(pid) == my_pid:
                continue
            try:
                exe0 = _proc_read_exe_basename(pid)
                if exe0 and re_pat.search(exe0):
                    strong.append(int(pid))
                    continue
            except Exception:
                pass
            try:
                a0 = _proc_read_argv0_basename(pid)
                if a0 and re_pat.search(a0):
                    strong.append(int(pid))
                    continue
            except Exception:
                pass
            try:
                cmd = _proc_read_cmdline(pid)
                if cmd and re_pat.search(cmd):
                    # NOTE: cmdline 匹配容易误命中（例如 sidecar 自己的路径/参数含 “codex”）。
                    # 仅在找不到任何“强匹配（exe/argv0）”时才会回退使用 cmdline 匹配。
                    weak.append(int(pid))
            except Exception:
                continue
        out = strong if strong else weak
        return out[:64]

    def _collect_process_tree(self, roots: Sequence[int]) -> List[int]:
        want: Set[int] = set()
        q = deque()
        for r in roots:
            try:
                pid = int(r)
            except Exception:
                continue
            want.add(pid)
            q.append(pid)

        # Build PPID mapping once; /proc is fast enough on Linux/WSL, and we call this
        # at file-scan cadence (not every line poll).
        try:
            pids = _proc_list_pids()
        except Exception:
            return sorted(want)
        children = {}
        for pid in pids:
            try:
                ppid = _proc_read_ppid(pid)
                if ppid:
                    children.setdefault(int(ppid), []).append(int(pid))
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

    def _find_rollout_opened_by_pids(self, pids: Sequence[int], *, limit: int = 12) -> Tuple[List[Path], List[int]]:
        found_by_path = {}
        mtime_by_path = {}
        openers_by_path: Dict[str, Set[int]] = {}
        root = None
        try:
            root = self._codex_home.resolve()
        except Exception:
            root = self._codex_home
        for pid in pids:
            try:
                it = _proc_iter_fd_targets_with_flags(int(pid))
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
                        if root is not None:
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
                    openers_by_path.setdefault(key, set()).add(int(pid))
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
