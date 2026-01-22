import unittest
from pathlib import Path
from typing import List, Optional
from unittest.mock import patch

from codex_sidecar.watch.rollout_follow_sync import FollowControls, build_follow_sync_plan


class _DummyPick:
    def __init__(
        self,
        *,
        picked: Optional[Path],
        follow_mode: str,
        process_file: Optional[Path] = None,
        process_files: Optional[List[Path]] = None,
        codex_detected: bool = False,
        codex_pids: Optional[List[int]] = None,
        candidate_pids: Optional[List[int]] = None,
    ) -> None:
        self.picked = picked
        self.follow_mode = follow_mode
        self.process_file = process_file
        self.process_files = process_files or []
        self.codex_detected = codex_detected
        self.codex_pids = codex_pids or []
        self.candidate_pids = candidate_pids or []


class _DummyFollowPicker:
    def __init__(self, pick: _DummyPick) -> None:
        self._pick = pick

    def pick(self, *, selection_mode: str, pinned_thread_id: str, pinned_file: Optional[Path]) -> _DummyPick:
        _ = selection_mode, pinned_thread_id, pinned_file
        return self._pick


class TestRolloutFollowSync(unittest.TestCase):
    def test_idle_skips_targets(self) -> None:
        picker = _DummyFollowPicker(_DummyPick(picked=None, follow_mode="wait_codex"))
        controls = FollowControls(
            selection_mode="auto",
            pinned_thread_id="",
            pinned_file=None,
            exclude_keys=set(),
            exclude_files=set(),
            watch_max_sessions=3,
        )
        with patch("codex_sidecar.watch.rollout_follow_sync.compute_follow_targets") as m:
            m.side_effect = AssertionError("compute_follow_targets should not be called in idle mode")
            plan = build_follow_sync_plan(
                follow_picker=picker,  # type: ignore[arg-type]
                controls=controls,
                codex_home=Path("/tmp"),
                latest_rollout_files=lambda _home, _n: [],
                parse_thread_id=lambda _p: "",
            )
        self.assertTrue(plan.idle)
        self.assertEqual(plan.targets, [])

    def test_pin_patches_missing_file_and_thread_id(self) -> None:
        picked = Path("/tmp/rollout-2026-01-22T00-00-00-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.jsonl")
        picker = _DummyFollowPicker(
            _DummyPick(
                picked=picked,
                follow_mode="process",
                process_file=picked,
                process_files=[picked],
                codex_detected=True,
                codex_pids=[123],
                candidate_pids=[123, 456],
            )
        )
        controls = FollowControls(
            selection_mode="pin",
            pinned_thread_id="",
            pinned_file=None,
            exclude_keys=set(),
            exclude_files=set(),
            watch_max_sessions=3,
        )
        with patch("codex_sidecar.watch.rollout_follow_sync.compute_follow_targets") as m:
            m.return_value = [picked]
            plan = build_follow_sync_plan(
                follow_picker=picker,  # type: ignore[arg-type]
                controls=controls,
                codex_home=Path("/tmp"),
                latest_rollout_files=lambda _home, _n: [],
                parse_thread_id=lambda _p: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
            )
        self.assertFalse(plan.idle)
        self.assertEqual(plan.picked, picked)
        self.assertEqual(plan.pinned_file, picked)
        self.assertEqual(plan.pinned_thread_id, "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")
        self.assertEqual(plan.targets, [picked])
        self.assertEqual(plan.candidate_pids, [123, 456])
        self.assertTrue(m.called)


if __name__ == "__main__":
    unittest.main()
