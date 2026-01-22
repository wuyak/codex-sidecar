import threading
import time
import unittest

from codex_sidecar.control.watcher_lifecycle import request_stop_and_join


class TestWatcherLifecycle(unittest.TestCase):
    def test_request_stop_and_join_no_thread(self) -> None:
        self.assertEqual(request_stop_and_join(stop_event=None, thread=None, join_timeout_s=0.01), False)

    def test_request_stop_and_join_stops_cooperative_thread(self) -> None:
        ev = threading.Event()

        def _worker() -> None:
            while not ev.is_set():
                time.sleep(0.01)

        t = threading.Thread(target=_worker, name="test-stop-coop", daemon=True)
        t.start()
        still = request_stop_and_join(stop_event=ev, thread=t, join_timeout_s=0.5)
        self.assertEqual(still, False)
        self.assertEqual(t.is_alive(), False)

    def test_request_stop_and_join_times_out_for_uncooperative_thread(self) -> None:
        ev = threading.Event()

        def _worker() -> None:
            # ignore ev; sleep longer than join timeout
            time.sleep(0.2)

        t = threading.Thread(target=_worker, name="test-stop-timeout", daemon=True)
        t.start()
        still = request_stop_and_join(stop_event=ev, thread=t, join_timeout_s=0.01)
        self.assertEqual(still, True)
        # cleanup
        t.join(timeout=1.0)
        self.assertEqual(t.is_alive(), False)


if __name__ == "__main__":
    unittest.main()

