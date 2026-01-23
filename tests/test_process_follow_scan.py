import os
import re
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Iterable, List, Optional, Tuple

from codex_sidecar.watch.process_follow_scan import (
    collect_process_tree,
    detect_processes,
    find_rollout_opened_by_pids,
    pid_matches_regex,
)


class TestProcessFollowScan(unittest.TestCase):
    def test_pid_matches_regex_fullmatch(self) -> None:
        pat = re.compile("codex", flags=re.IGNORECASE)
        self.assertTrue(
            pid_matches_regex(
                123,
                pat,
                read_exe_basename=lambda _pid: "",
                read_argv0_basename=lambda _pid: "codex",
            )
        )
        self.assertFalse(
            pid_matches_regex(
                123,
                pat,
                read_exe_basename=lambda _pid: "",
                read_argv0_basename=lambda _pid: "codex-tui",
            )
        )

    def test_detect_processes_excludes_self_and_honors_limit(self) -> None:
        pat = re.compile("codex", flags=re.IGNORECASE)

        def _list() -> List[int]:
            return [1, 2, 3]

        def _exe(_pid: int) -> str:
            return ""

        def _a0(pid: int) -> str:
            if pid in (2, 3):
                return "codex"
            return "bash"

        self.assertEqual(
            detect_processes(
                re_pat=pat,
                list_pids=_list,
                read_exe_basename=_exe,
                read_argv0_basename=_a0,
                exclude_pid=2,
                limit=1,
            ),
            [3],
        )

    def test_collect_process_tree(self) -> None:
        def _list() -> List[int]:
            return [100, 101, 102, 103]

        def _ppid(pid: int) -> Optional[int]:
            if pid == 101:
                return 100
            if pid == 102:
                return 101
            if pid == 103:
                return 999
            return None

        self.assertEqual(
            collect_process_tree([100], list_pids=_list, read_ppid=_ppid),
            [100, 101, 102],
        )

    def test_find_rollout_opened_by_pids_filters_by_flags_and_codex_home(self) -> None:
        with TemporaryDirectory() as td:
            base = Path(td) / "codex_home"
            p = base / "sessions" / "2026" / "01" / "20"
            p.mkdir(parents=True, exist_ok=True)

            r1 = p / "rollout-2026-01-20T00-00-00-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.jsonl"
            r2 = p / "rollout-2026-01-20T00-00-01-bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb.jsonl"
            r1.write_text("{}", encoding="utf-8")
            r2.write_text("{}", encoding="utf-8")

            # Ensure r2 is newer.
            try:
                os.utime(str(r1), (1, 1))
                os.utime(str(r2), (2, 2))
            except Exception:
                pass

            other = Path(td) / "other"
            op = other / "sessions" / "2026" / "01" / "20"
            op.mkdir(parents=True, exist_ok=True)
            r_out = op / "rollout-2026-01-20T00-00-02-cccccccc-cccc-cccc-cccc-cccccccccccc.jsonl"
            r_out.write_text("{}", encoding="utf-8")

            def _iter(pid: int) -> Iterable[Tuple[str, int]]:
                if pid == 1:
                    # Read-only: must be filtered out.
                    return [(str(r2), int(getattr(os, "O_RDONLY", 0)))]
                if pid == 2:
                    return [(str(r2), int(getattr(os, "O_WRONLY", 1)))]
                if pid == 3:
                    # Looks like a rollout path but outside CODEX_HOME: must be filtered out.
                    return [(str(r_out), int(getattr(os, "O_WRONLY", 1)))]
                return []

            files, openers = find_rollout_opened_by_pids(
                [1, 2, 3],
                codex_home=base,
                iter_fd_targets_with_flags=_iter,
                limit=1,
            )
            self.assertEqual([Path(str(x)).resolve() for x in files], [r2.resolve()])
            self.assertEqual(openers, [2])


if __name__ == "__main__":
    unittest.main()
