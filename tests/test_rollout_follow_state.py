import tempfile
import unittest
from dataclasses import dataclass
from pathlib import Path

from codex_sidecar.watch.rollout_follow_state import apply_follow_targets


@dataclass
class _Cursor:
    path: Path
    thread_id: str
    offset: int = 0
    line_no: int = 0
    active: bool = False
    last_active_ts: float = 0.0
    inited: bool = False


class TestRolloutFollowState(unittest.TestCase):
    def test_inits_cursor_once_and_derives_primary(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            p = Path(td) / "rollout-2026-01-01T00-00-00-11111111-1111-1111-1111-111111111111.jsonl"
            p.write_text("a\nb\nc\n", encoding="utf-8")

            cursors = {}
            replay_calls = []

            def _read_tail_lines(_path: Path, *, last_lines: int):
                # Not used by this test stub.
                return []

            def _replay_tail(cur, *, last_lines: int, read_tail_lines, stop_requested, on_line):
                replay_calls.append((Path(cur.path), int(last_lines)))
                # Simulate replay effect: line_no increments by the number of replayed lines.
                for _ in range(int(last_lines)):
                    cur.line_no += 1

            def _stop_requested() -> bool:
                return False

            def _on_line(*args, **kwargs) -> int:
                return 0

            def _parse_thread_id(_path: Path) -> str:
                return "tid"

            cur_file, tid, off, line_no = apply_follow_targets(
                targets=[p],
                cursors=cursors,
                new_cursor=_Cursor,
                now=123.0,
                replay_last_lines=2,
                read_tail_lines=_read_tail_lines,
                replay_tail=_replay_tail,
                stop_requested=_stop_requested,
                on_line=_on_line,
                parse_thread_id=_parse_thread_id,
                prev_primary_offset=0,
                prev_primary_line_no=0,
            )

            self.assertEqual(cur_file, p)
            self.assertEqual(tid, "tid")
            self.assertEqual(off, p.stat().st_size)
            self.assertEqual(line_no, 2)
            self.assertEqual(replay_calls, [(p, 2)])

            cur = cursors.get(p)
            self.assertIsNotNone(cur)
            self.assertEqual(cur.inited, True)
            self.assertEqual(cur.active, True)
            self.assertEqual(cur.offset, p.stat().st_size)
            self.assertEqual(cur.line_no, 2)
            self.assertEqual(cur.last_active_ts, 123.0)

            # Append to file: a second apply should NOT reset offset or replay again.
            before_offset = int(cur.offset)
            p.write_text("a\nb\nc\nd\n", encoding="utf-8")
            apply_follow_targets(
                targets=[p],
                cursors=cursors,
                new_cursor=_Cursor,
                now=124.0,
                replay_last_lines=2,
                read_tail_lines=_read_tail_lines,
                replay_tail=_replay_tail,
                stop_requested=_stop_requested,
                on_line=_on_line,
                parse_thread_id=_parse_thread_id,
                prev_primary_offset=before_offset,
                prev_primary_line_no=int(cur.line_no),
            )
            self.assertEqual(replay_calls, [(p, 2)])
            self.assertEqual(int(cur.offset), before_offset)
            self.assertEqual(cur.line_no, 2)
            self.assertEqual(cur.last_active_ts, 124.0)


if __name__ == "__main__":
    unittest.main()

