import queue
import unittest
from collections import deque

from codex_sidecar.watch.translation_pump_batching import collect_batch_from_lo


class TestTranslationPumpBatching(unittest.TestCase):
    def test_non_batchable_returns_single(self) -> None:
        lo: "queue.Queue[dict]" = queue.Queue()
        pending = deque()
        first = {"id": "1", "text": "a", "key": "k", "batchable": False}
        batch = collect_batch_from_lo(first, lo_queue=lo, pending=pending, batch_size=5)
        self.assertEqual(batch, [first])
        self.assertEqual(list(pending), [])

    def test_collects_same_key_and_pushes_mismatched_to_pending(self) -> None:
        lo: "queue.Queue[dict]" = queue.Queue()
        pending = deque()
        first = {"id": "1", "text": "a", "key": "k1", "batchable": True}
        same2 = {"id": "2", "text": "b", "key": "k1", "batchable": True}
        other = {"id": "x", "text": "x", "key": "k2", "batchable": True}
        same3 = {"id": "3", "text": "c", "key": "k1", "batchable": True}

        lo.put(other)
        lo.put(same2)
        lo.put(same3)

        batch = collect_batch_from_lo(first, lo_queue=lo, pending=pending, batch_size=3)
        # Order: mismatched consumed first -> pending, then same2/same3 consumed into batch.
        self.assertEqual(batch, [first, same2, same3])
        self.assertEqual(list(pending), [other])
        self.assertTrue(lo.empty())

    def test_batch_size_limit_leaves_rest_in_queue(self) -> None:
        lo: "queue.Queue[dict]" = queue.Queue()
        pending = deque()
        first = {"id": "1", "text": "a", "key": "k1", "batchable": True}
        same2 = {"id": "2", "text": "b", "key": "k1", "batchable": True}
        same3 = {"id": "3", "text": "c", "key": "k1", "batchable": True}

        lo.put(same2)
        lo.put(same3)

        batch = collect_batch_from_lo(first, lo_queue=lo, pending=pending, batch_size=2)
        self.assertEqual(batch, [first, same2])
        self.assertEqual(list(pending), [])
        # same3 should remain in the queue (not consumed).
        self.assertFalse(lo.empty())
        self.assertEqual(lo.get_nowait(), same3)


if __name__ == "__main__":
    unittest.main()
