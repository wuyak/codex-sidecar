import queue
import unittest

from codex_sidecar.http.state import SidecarState


class TestStateBroadcastPriority(unittest.TestCase):
    def test_high_priority_survives_backpressure_tool_gate(self) -> None:
        st = SidecarState(max_messages=1000)
        q = st.subscribe()

        # Fill the subscriber queue with low-value noise (e.g. translation backfill updates).
        for i in range(int(getattr(q, "maxsize", 0) or 0)):
            q.put_nowait({"id": f"u{i}", "op": "update", "kind": "reasoning_summary", "text": "x"})

        st.add({"id": "tg1", "kind": "tool_gate", "text": "waiting"})

        found = False
        drained = 0
        while True:
            try:
                m = q.get_nowait()
            except queue.Empty:
                break
            drained += 1
            if isinstance(m, dict) and m.get("id") == "tg1":
                found = True

        # Queue was full; tool_gate should still be delivered by evicting one old item.
        self.assertGreater(drained, 0)
        self.assertTrue(found)

    def test_high_priority_survives_backpressure_assistant_message(self) -> None:
        st = SidecarState(max_messages=1000)
        q = st.subscribe()

        for i in range(int(getattr(q, "maxsize", 0) or 0)):
            q.put_nowait({"id": f"u{i}", "op": "update", "kind": "reasoning_summary", "text": "x"})

        st.add({"id": "a1", "kind": "assistant_message", "text": "hello"})

        found = False
        while True:
            try:
                m = q.get_nowait()
            except queue.Empty:
                break
            if isinstance(m, dict) and m.get("id") == "a1":
                found = True
        self.assertTrue(found)

    def test_low_priority_drops_under_backpressure(self) -> None:
        st = SidecarState(max_messages=1000)
        q = st.subscribe()

        for i in range(int(getattr(q, "maxsize", 0) or 0)):
            q.put_nowait({"id": f"u{i}", "op": "update", "kind": "reasoning_summary", "text": "x"})

        st.add({"id": "c1", "kind": "tool_call", "text": "noisy"})

        found = False
        while True:
            try:
                m = q.get_nowait()
            except queue.Empty:
                break
            if isinstance(m, dict) and m.get("id") == "c1":
                found = True
        self.assertFalse(found)


if __name__ == "__main__":
    unittest.main()

