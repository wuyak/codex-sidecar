import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from codex_sidecar.watch.follow_picker import FollowPicker


class TestFollowPicker(unittest.TestCase):
    def test_pick_pinned_without_process_follow(self) -> None:
        with TemporaryDirectory() as td:
            base = Path(td)
            p = base / "sessions" / "2026" / "01" / "20"
            p.mkdir(parents=True, exist_ok=True)
            name = "rollout-2026-01-20T23-44-00-01234567-89ab-cdef-0123-456789abcdef.jsonl"
            f = p / name
            f.write_text("{}", encoding="utf-8")

            fp = FollowPicker(
                codex_home=base,
                follow_codex_process=False,
                codex_process_regex="codex",
                only_follow_when_process=True,
            )

            picked = fp.pick(selection_mode="pin", pinned_thread_id="", pinned_file=f)
            self.assertIsNotNone(picked.picked)
            self.assertEqual(Path(str(picked.picked)).resolve(), f.resolve())
            self.assertEqual(picked.thread_id, "01234567-89ab-cdef-0123-456789abcdef")
            self.assertEqual(picked.follow_mode, "pinned")
            self.assertEqual(picked.codex_detected, False)

    def test_pick_pinned_with_process_follow_idles_when_no_codex(self) -> None:
        with TemporaryDirectory() as td:
            base = Path(td)
            p = base / "sessions" / "2026" / "01" / "20"
            p.mkdir(parents=True, exist_ok=True)
            name = "rollout-2026-01-20T23-44-00-01234567-89ab-cdef-0123-456789abcdef.jsonl"
            f = p / name
            f.write_text("{}", encoding="utf-8")

            fp = FollowPicker(
                codex_home=base,
                follow_codex_process=True,
                codex_process_regex="codex",
                only_follow_when_process=True,
            )

            with patch("codex_sidecar.watch.follow_picker.FollowPicker._detect_codex_processes", return_value=[]):
                picked = fp.pick(selection_mode="pin", pinned_thread_id="", pinned_file=f)
                self.assertIsNone(picked.picked)
                self.assertEqual(picked.follow_mode, "idle")
                self.assertEqual(picked.codex_detected, False)

    def test_pick_pinned_with_process_follow_waits_rollout_when_no_open_files(self) -> None:
        with TemporaryDirectory() as td:
            base = Path(td)
            p = base / "sessions" / "2026" / "01" / "20"
            p.mkdir(parents=True, exist_ok=True)
            name = "rollout-2026-01-20T23-44-00-01234567-89ab-cdef-0123-456789abcdef.jsonl"
            f = p / name
            f.write_text("{}", encoding="utf-8")

            fp = FollowPicker(
                codex_home=base,
                follow_codex_process=True,
                codex_process_regex="codex",
                only_follow_when_process=True,
            )

            with patch("codex_sidecar.watch.follow_picker.FollowPicker._detect_codex_processes", return_value=[123]), patch(
                "codex_sidecar.watch.follow_picker.FollowPicker._collect_process_tree",
                return_value=[123],
            ), patch(
                "codex_sidecar.watch.follow_picker.FollowPicker._find_rollout_opened_by_pids",
                return_value=([], []),
            ):
                picked = fp.pick(selection_mode="pin", pinned_thread_id="", pinned_file=f)
                self.assertIsNone(picked.picked)
                self.assertEqual(picked.follow_mode, "wait_rollout")
                self.assertEqual(picked.codex_detected, True)

    def test_pick_pinned_with_process_follow_ignores_stale_pin(self) -> None:
        with TemporaryDirectory() as td:
            base = Path(td)
            p = base / "sessions" / "2026" / "01" / "20"
            p.mkdir(parents=True, exist_ok=True)

            pinned_name = "rollout-2026-01-20T23-44-00-01234567-89ab-cdef-0123-456789abcdef.jsonl"
            pinned_f = p / pinned_name
            pinned_f.write_text("{}", encoding="utf-8")

            active_name = "rollout-2026-01-20T23-44-01-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.jsonl"
            active_f = p / active_name
            active_f.write_text("{}", encoding="utf-8")

            fp = FollowPicker(
                codex_home=base,
                follow_codex_process=True,
                codex_process_regex="codex",
                only_follow_when_process=True,
            )

            with patch("codex_sidecar.watch.follow_picker.FollowPicker._detect_codex_processes", return_value=[123]), patch(
                "codex_sidecar.watch.follow_picker.FollowPicker._collect_process_tree",
                return_value=[123],
            ), patch(
                "codex_sidecar.watch.follow_picker.FollowPicker._find_rollout_opened_by_pids",
                return_value=([active_f], [123]),
            ):
                picked = fp.pick(selection_mode="pin", pinned_thread_id="", pinned_file=pinned_f)
                self.assertIsNotNone(picked.picked)
                self.assertEqual(Path(str(picked.picked)).resolve(), active_f.resolve())
                self.assertEqual(picked.follow_mode, "process")

    def test_process_follow_strong_scan_refreshes_candidates(self) -> None:
        with TemporaryDirectory() as td:
            base = Path(td)
            fp = FollowPicker(
                codex_home=base,
                follow_codex_process=True,
                codex_process_regex="codex",
                only_follow_when_process=True,
            )

            scans = [
                [111111, 111112],
                [111111, 111112, 111113],
            ]

            def _list_pids():
                return list(scans.pop(0))

            def _argv0(pid: int) -> str:
                if int(pid) in (111111, 111113):
                    return "codex"
                if int(pid) == 111112:
                    return "codex-tui"
                return "bash"

            with patch("codex_sidecar.watch.follow_picker._proc_list_pids", side_effect=_list_pids), patch(
                "codex_sidecar.watch.follow_picker._proc_read_exe_basename",
                return_value="",
            ), patch(
                "codex_sidecar.watch.follow_picker._proc_read_argv0_basename",
                side_effect=_argv0,
            ), patch(
                "codex_sidecar.watch.follow_picker._proc_iter_fd_targets_with_flags",
                return_value=[],
            ), patch(
                "codex_sidecar.watch.follow_picker.FollowPicker._collect_process_tree",
                side_effect=lambda roots: list(roots),
            ):
                pick1 = fp.pick(selection_mode="auto", pinned_thread_id="", pinned_file=None)
                self.assertEqual(pick1.candidate_pids, [111111])

                pick2 = fp.pick(selection_mode="auto", pinned_thread_id="", pinned_file=None)
                self.assertEqual(pick2.candidate_pids, [111111, 111113])


if __name__ == "__main__":
    unittest.main()
