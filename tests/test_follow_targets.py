import unittest
from pathlib import Path

from codex_sidecar.watch.follow_targets import compute_follow_targets


def _parse_thread_id_from_name(p: Path) -> str:
    # Test helper: filenames embed tid as "...-<tid>.jsonl" or "..._<tid>".
    s = p.name
    if s.endswith(".jsonl"):
        s = s[: -len(".jsonl")]
    if "-" in s:
        return s.split("-")[-1]
    if "_" in s:
        return s.split("_")[-1]
    return ""


class TestFollowTargets(unittest.TestCase):
    def test_process_mode_only_uses_process_files_and_excludes(self) -> None:
        called = {"n": 0}

        def _latest(_codex_home: Path, *, limit: int) -> list:
            called["n"] += 1
            return []

        p1 = Path("/tmp/rollout-aaa-t1.jsonl")
        p2 = Path("/tmp/rollout-bbb-t2.jsonl")
        p3 = Path("/tmp/rollout-ccc-t3.jsonl")
        out = compute_follow_targets(
            selection_mode="auto",
            watch_max_sessions=2,
            follow_mode="process",
            picked=Path("/tmp/rollout-picked-tx.jsonl"),
            process_files=[p1, p2, p3],
            codex_home=Path("/tmp/.codex"),
            latest_rollout_files=_latest,
            exclude_keys={"t2"},
            exclude_files=set(),
            parse_thread_id=_parse_thread_id_from_name,
        )
        self.assertEqual(out, [p1, p3])
        self.assertEqual(called["n"], 0)

    def test_pin_mode_never_backfills_from_sessions(self) -> None:
        called = {"n": 0}

        def _latest(_codex_home: Path, *, limit: int) -> list:
            called["n"] += 1
            return [Path("/tmp/rollout-sessions-t9.jsonl")]

        picked = Path("/tmp/rollout-picked-tp1.jsonl")
        p2 = Path("/tmp/rollout-proc-tp2.jsonl")
        p3 = Path("/tmp/rollout-proc-tp3.jsonl")
        out = compute_follow_targets(
            selection_mode="pin",
            watch_max_sessions=3,
            follow_mode="pinned",
            picked=picked,
            process_files=[p2, p3],
            codex_home=Path("/tmp/.codex"),
            latest_rollout_files=_latest,
            exclude_keys=set(),
            exclude_files=set(),
            parse_thread_id=_parse_thread_id_from_name,
        )
        self.assertEqual(out, [picked, p2, p3])
        self.assertEqual(called["n"], 0)

    def test_auto_mode_backfills_from_latest_and_skips_duplicates_and_excludes(self) -> None:
        got = {"limit": None}

        def _latest(_codex_home: Path, *, limit: int) -> list:
            got["limit"] = int(limit)
            return [
                Path("/tmp/rollout-picked-ta.jsonl"),
                Path("/tmp/rollout-excl-tb.jsonl"),
                Path("/tmp/rollout-ok-tc.jsonl"),
                Path("/tmp/rollout-ok-td.jsonl"),
            ]

        picked = Path("/tmp/rollout-picked-ta.jsonl")
        excl = Path("/tmp/rollout-excl-tb.jsonl")
        ok1 = Path("/tmp/rollout-ok-tc.jsonl")
        ok2 = Path("/tmp/rollout-ok-td.jsonl")

        out = compute_follow_targets(
            selection_mode="auto",
            watch_max_sessions=3,
            follow_mode="legacy",
            picked=picked,
            process_files=[],
            codex_home=Path("/tmp/.codex"),
            latest_rollout_files=_latest,
            exclude_keys=set(),
            exclude_files={excl},
            parse_thread_id=_parse_thread_id_from_name,
        )
        self.assertEqual(out, [picked, ok1, ok2])
        self.assertEqual(got["limit"], 9)


if __name__ == "__main__":
    unittest.main()

