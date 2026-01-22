import unittest

from codex_sidecar.watch.rollout_watcher_loop import decide_follow_sync_force, should_poll_tui


class TestRolloutWatcherLoop(unittest.TestCase):
    def test_should_poll_tui_throttles_when_idle_and_no_codex(self) -> None:
        self.assertFalse(
            should_poll_tui(
                follow_mode="idle",
                codex_detected=False,
                now_ts=10.0,
                last_poll_ts=9.1,
                file_scan_interval_s=2.0,
            )
        )
        self.assertTrue(
            should_poll_tui(
                follow_mode="idle",
                codex_detected=False,
                now_ts=12.1,
                last_poll_ts=9.1,
                file_scan_interval_s=2.0,
            )
        )

    def test_should_poll_tui_no_throttle_when_codex_detected(self) -> None:
        self.assertTrue(
            should_poll_tui(
                follow_mode="idle",
                codex_detected=True,
                now_ts=10.0,
                last_poll_ts=9.9,
                file_scan_interval_s=60.0,
            )
        )

    def test_should_poll_tui_no_throttle_outside_idle_modes(self) -> None:
        for mode in ("process", "fallback", "wait_rollout", "legacy", "pinned"):
            self.assertTrue(
                should_poll_tui(
                    follow_mode=mode,
                    codex_detected=False,
                    now_ts=10.0,
                    last_poll_ts=9.9,
                    file_scan_interval_s=60.0,
                ),
                msg=f"mode={mode}",
            )

    def test_decide_follow_sync_force_immediate_when_force_switch(self) -> None:
        self.assertEqual(
            decide_follow_sync_force(
                force_switch=True,
                now_ts=10.0,
                last_scan_ts=0.0,
                file_scan_interval_s=2.0,
            ),
            True,
        )

    def test_decide_follow_sync_force_periodic_when_due(self) -> None:
        self.assertEqual(
            decide_follow_sync_force(
                force_switch=False,
                now_ts=10.0,
                last_scan_ts=7.9,
                file_scan_interval_s=2.0,
            ),
            False,
        )
        self.assertIsNone(
            decide_follow_sync_force(
                force_switch=False,
                now_ts=9.0,
                last_scan_ts=7.9,
                file_scan_interval_s=2.0,
            )
        )


if __name__ == "__main__":
    unittest.main()
