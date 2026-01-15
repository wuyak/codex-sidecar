import re
from collections import deque
from dataclasses import dataclass
from pathlib import Path
from typing import List, Optional, Pattern, Sequence, Set

from .procfs import _proc_iter_fd_targets, _proc_list_pids, _proc_read_cmdline, _proc_read_ppid
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
    codex_pids: List[int]
    process_file: Optional[Path]


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
            )

        tid = _parse_thread_id_from_filename(cand)
        return FollowPick(
            picked=cand,
            thread_id=tid,
            follow_mode="pinned",
            codex_detected=False,
            codex_pids=[],
            process_file=None,
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
                )
            picked = _latest_rollout_file(self._codex_home)
            return FollowPick(
                picked=picked,
                thread_id=_parse_thread_id_from_filename(picked) if picked is not None else None,
                follow_mode="fallback",
                codex_detected=False,
                codex_pids=[],
                process_file=None,
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
                )
            picked = _latest_rollout_file(self._codex_home)
            return FollowPick(
                picked=picked,
                thread_id=_parse_thread_id_from_filename(picked) if picked is not None else None,
                follow_mode="fallback",
                codex_detected=False,
                codex_pids=[],
                process_file=None,
            )

        tree = self._collect_process_tree(pids)
        opened = self._find_rollout_opened_by_pids(tree)
        if opened is not None:
            return FollowPick(
                picked=opened,
                thread_id=_parse_thread_id_from_filename(opened),
                follow_mode="process",
                codex_detected=True,
                codex_pids=list(pids),
                process_file=opened,
            )

        # Codex is running but we can't find an opened rollout yet; fallback to sessions scan.
        picked = _latest_rollout_file(self._codex_home)
        return FollowPick(
            picked=picked,
            thread_id=_parse_thread_id_from_filename(picked) if picked is not None else None,
            follow_mode="wait_rollout" if picked is not None else "wait_rollout",
            codex_detected=True,
            codex_pids=list(pids),
            process_file=None,
        )

    def _detect_codex_processes(self) -> List[int]:
        re_pat = self._codex_process_re
        if re_pat is None:
            return []
        out: List[int] = []
        try:
            pids = _proc_list_pids()
        except Exception:
            return []
        for pid in pids:
            try:
                cmd = _proc_read_cmdline(pid)
                if cmd and re_pat.search(cmd):
                    out.append(int(pid))
            except Exception:
                continue
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

    def _find_rollout_opened_by_pids(self, pids: Sequence[int]) -> Optional[Path]:
        best: Optional[Path] = None
        best_mtime = -1.0
        for pid in pids:
            try:
                it = _proc_iter_fd_targets(int(pid))
            except Exception:
                continue
            for target in it:
                try:
                    if not target or "sessions" not in target or "rollout-" not in target or not target.endswith(".jsonl"):
                        continue
                    cand = Path(target)
                    if not _ROLLOUT_RE.match(cand.name):
                        continue
                    if not cand.exists() or not cand.is_file():
                        continue
                    mt = cand.stat().st_mtime
                    if mt > best_mtime:
                        best = cand
                        best_mtime = mt
                except Exception:
                    continue
        return best

