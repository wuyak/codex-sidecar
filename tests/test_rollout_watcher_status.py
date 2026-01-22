import unittest
from pathlib import Path

from codex_sidecar.watch.rollout_watcher_status import build_watcher_status


class TestRolloutWatcherStatus(unittest.TestCase):
    def test_build_watcher_status_keeps_shape_and_truncates_lists(self) -> None:
        follow_files = [Path(f"/tmp/f{i}.jsonl") for i in range(20)]
        process_files = [Path(f"/tmp/p{i}.jsonl") for i in range(20)]
        st = build_watcher_status(
            current_file=Path("/tmp/current.jsonl"),
            thread_id="tid",
            offset=123,
            line_no=7,
            last_error="",
            follow_mode="process",
            selection_mode="auto",
            pinned_thread_id="",
            pinned_file="",
            watch_max_sessions=3,
            replay_last_lines=200,
            poll_interval_s=0.5,
            file_scan_interval_s=2.0,
            follow_files=follow_files,
            codex_detected=True,
            codex_pids=list(range(20)),
            codex_candidate_pids=list(range(20)),
            codex_process_regex="codex",
            process_file=Path("/tmp/current.jsonl"),
            process_files=process_files,
            translate_stats={"hi_q": 1},
        )
        self.assertEqual(st.get("current_file"), "/tmp/current.jsonl")
        self.assertEqual(st.get("thread_id"), "tid")
        self.assertEqual(st.get("offset"), "123")
        self.assertEqual(st.get("line_no"), "7")
        self.assertEqual(st.get("codex_detected"), "1")
        self.assertEqual(st.get("codex_pids"), ",".join(str(i) for i in range(8)))
        self.assertEqual(st.get("codex_candidate_pids"), ",".join(str(i) for i in range(8)))
        self.assertEqual(len(st.get("follow_files") or []), 12)
        self.assertEqual(len(st.get("process_files") or []), 12)
        self.assertIsInstance(st.get("translate"), dict)


if __name__ == "__main__":
    unittest.main()

