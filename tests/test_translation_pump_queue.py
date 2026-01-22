import unittest

from codex_sidecar.watch.translation_pump_core import TranslationPump
from codex_sidecar.watch.translation_queue import TranslationQueueState


class TestTranslationQueueState(unittest.TestCase):
    def test_accept_or_reject_seen(self) -> None:
        st = TranslationQueueState(max_seen_ids=10)
        self.assertEqual(st.accept_or_reject_seen("a"), True)
        self.assertEqual(st.accept_or_reject_seen("a"), False)

    def test_force_after_coalesce_and_requeue(self) -> None:
        st = TranslationQueueState(max_seen_ids=10)
        st.mark_inflight("a")
        follow = {"id": "a", "text": "NEW", "key": "k", "batchable": False}
        self.assertEqual(st.record_force_after_if_inflight("a", follow), True)

        out = st.done_id("a")
        self.assertIsInstance(out, dict)
        self.assertEqual(out.get("text"), "NEW")

        # After done, follow-up should be eligible to run and mark inflight again.
        self.assertEqual(st.try_mark_inflight_for_follow("a", out), True)
        self.assertEqual(st.is_inflight("a"), True)

    def test_try_mark_inflight_for_follow_coalesces_if_already_inflight(self) -> None:
        st = TranslationQueueState(max_seen_ids=10)
        st.mark_inflight("a")
        follow = {"id": "a", "text": "NEW", "key": "k", "batchable": False}
        self.assertEqual(st.try_mark_inflight_for_follow("a", follow), False)
        self.assertEqual(st.is_inflight("a"), True)


class _FakeTranslator:
    def __init__(self) -> None:
        self.last_error = ""

    def translate(self, text: str) -> str:
        return f"ZH:{text}"


class TestTranslationPumpQueueIntegration(unittest.TestCase):
    def test_put_drop_oldest_clears_inflight_of_dropped_item(self) -> None:
        pump = TranslationPump(translator=_FakeTranslator(), emit_update=lambda _msg: True, batch_size=2, max_queue=50, max_seen_ids=100)

        # Fill hi queue to its max (qmax=50 => hi maxsize=10).
        for i in range(10):
            mid = f"id{i}"
            pump._qstate.mark_inflight(mid)
            pump._hi.put_nowait({"id": mid, "text": "x", "key": "k", "batchable": False})

        pump._qstate.mark_inflight("new")
        ok = pump._put_drop_oldest(pump._hi, {"id": "new", "text": "x", "key": "k", "batchable": False}, is_hi=True)
        self.assertEqual(ok, True)

        # Oldest item should have been dropped and its inflight cleared.
        self.assertEqual(pump._qstate.is_inflight("id0"), False)
        self.assertEqual(pump._qstate.is_inflight("new"), True)

        # Queue size stays bounded.
        self.assertEqual(pump._hi.qsize(), 10)


if __name__ == "__main__":
    unittest.main()
