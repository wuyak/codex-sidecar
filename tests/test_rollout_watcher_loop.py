import unittest

from codex_sidecar.watch.rollout_watcher_loop import should_poll_tui


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


if __name__ == "__main__":
    unittest.main()

