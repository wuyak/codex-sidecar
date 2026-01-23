import os
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import List, Optional, Pattern, Sequence, Tuple

from .procfs import (
    _proc_iter_fd_targets_with_flags,
    _proc_list_pids,
    _proc_read_argv0_basename,
    _proc_read_exe_basename,
    _proc_read_ppid,
)
from .process_follow_scan import (
    collect_process_tree as _collect_process_tree_impl,
    detect_processes as _detect_processes_impl,
    find_rollout_opened_by_pids as _find_rollout_opened_by_pids_impl,
    pid_matches_regex as _pid_matches_regex_impl,
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
    codex_pids: List[int] = field(default_factory=list)
    process_file: Optional[Path] = None
    process_files: List[Path] = field(default_factory=list)
    # Candidate root PIDs matched by regex (debugging only).
    candidate_pids: List[int] = field(default_factory=list)


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
            )

        if self._codex_process_re is None:
            if self._only_follow_when_process:
                return FollowPick(
                    picked=None,
                    thread_id=None,
                    follow_mode="wait_codex",
                    codex_detected=False,
                )
            picked = _latest_rollout_file(self._codex_home)
            return FollowPick(
                picked=picked,
                thread_id=_parse_thread_id_from_filename(picked) if picked is not None else None,
                follow_mode="fallback",
                codex_detected=False,
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
                )
            picked = _latest_rollout_file(self._codex_home)
            return FollowPick(
                picked=picked,
                thread_id=_parse_thread_id_from_filename(picked) if picked is not None else None,
                follow_mode="fallback",
                codex_detected=False,
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

    def _pid_matches_codex(self, pid: int) -> bool:
        re_pat = self._codex_process_re
        if re_pat is None:
            return False
        return _pid_matches_regex_impl(
            int(pid),
            re_pat,
            read_exe_basename=_proc_read_exe_basename,
            read_argv0_basename=_proc_read_argv0_basename,
        )

    def _detect_codex_processes(self) -> List[int]:
        """
        Full scan of /proc to find candidate Codex processes (strong match only).

        约定（更精准，默认不误伤）：
        - 仅匹配 /proc/<pid>/exe basename 与 argv0 basename（fullmatch）
        - 不再回退到整条 cmdline 的弱匹配（避免“名字里带 codex”的非目标进程污染名单）
        """
        re_pat = self._codex_process_re
        try:
            my_pid = int(os.getpid())
        except Exception:
            my_pid = None
        return _detect_processes_impl(
            re_pat=re_pat,
            list_pids=_proc_list_pids,
            read_exe_basename=_proc_read_exe_basename,
            read_argv0_basename=_proc_read_argv0_basename,
            exclude_pid=my_pid,
            limit=64,
        )

    def _collect_process_tree(self, roots: Sequence[int]) -> List[int]:
        return _collect_process_tree_impl(roots, list_pids=_proc_list_pids, read_ppid=_proc_read_ppid)

    def _find_rollout_opened_by_pids(self, pids: Sequence[int], *, limit: int = 12) -> Tuple[List[Path], List[int]]:
        return _find_rollout_opened_by_pids_impl(
            pids,
            codex_home=self._codex_home,
            iter_fd_targets_with_flags=_proc_iter_fd_targets_with_flags,
            limit=limit,
        )
