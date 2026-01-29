import queue
import threading
import time
import unittest
from typing import Any, Dict, List

from codex_sidecar.watch.translation_pump_core import TranslationPump


class _NamedTranslator:
    def __init__(self, name: str) -> None:
        self.name = str(name or "")
        self.last_error = ""

    def translate(self, text: str) -> str:
        return f"{self.name}:{text}"


def _collect(q: "queue.Queue", n: int, *, timeout_s: float = 1.5) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    deadline = time.time() + float(timeout_s)
    while len(out) < int(n):
        left = deadline - time.time()
        if left <= 0:
            break
        try:
            out.append(q.get(timeout=left))
        except queue.Empty:
            break
    return out


class TestTranslationPumpTranslatorSwitch(unittest.TestCase):
    def test_pending_items_keep_translator_snapshot(self) -> None:
        out_q = queue.Queue()
        pump = TranslationPump(translator=_NamedTranslator("A"), emit_update=lambda msg: (out_q.put(msg) or True), batch_size=2, max_queue=50)

        # Enqueue before starting the worker so there's no race.
        self.assertEqual(pump.enqueue(mid="m1", text="hello", thread_key="k", batchable=False), True)
        pump.set_translator(_NamedTranslator("B"))

        stop = threading.Event()
        pump.start(stop)
        msgs = _collect(out_q, 1, timeout_s=2.0)
        stop.set()

        self.assertEqual(len(msgs), 1)
        self.assertEqual(msgs[0].get("id"), "m1")
        self.assertEqual(msgs[0].get("zh"), "A:hello")

    def test_items_enqueued_after_switch_use_new_translator(self) -> None:
        out_q = queue.Queue()
        pump = TranslationPump(translator=_NamedTranslator("A"), emit_update=lambda msg: (out_q.put(msg) or True), batch_size=2, max_queue=50)

        self.assertEqual(pump.enqueue(mid="m1", text="one", thread_key="k", batchable=False), True)
        pump.set_translator(_NamedTranslator("B"))
        self.assertEqual(pump.enqueue(mid="m2", text="two", thread_key="k", batchable=False), True)

        stop = threading.Event()
        pump.start(stop)
        msgs = _collect(out_q, 2, timeout_s=2.0)
        stop.set()

        by_id = {m.get("id"): m for m in msgs if isinstance(m, dict)}
        self.assertEqual(by_id.get("m1", {}).get("zh"), "A:one")
        self.assertEqual(by_id.get("m2", {}).get("zh"), "B:two")

    def test_force_retranslate_uses_translator_at_click_time_even_if_inflight(self) -> None:
        out_q = queue.Queue()
        pump = TranslationPump(translator=_NamedTranslator("A"), emit_update=lambda msg: (out_q.put(msg) or True), batch_size=2, max_queue=50)

        # Auto translation queued first (A) -> marks inflight.
        self.assertEqual(pump.enqueue(mid="m1", text="hello", thread_key="k", batchable=False, force=False), True)

        # User switches translator and clicks "retranslate" while inflight.
        pump.set_translator(_NamedTranslator("B"))
        self.assertEqual(pump.enqueue(mid="m1", text="hello", thread_key="k", batchable=False, force=True, fallback_zh="A:hello"), True)

        stop = threading.Event()
        pump.start(stop)
        msgs = _collect(out_q, 2, timeout_s=3.0)
        stop.set()

        self.assertEqual(len(msgs), 2)
        self.assertEqual(msgs[0].get("id"), "m1")
        self.assertEqual(msgs[0].get("zh"), "A:hello")
        self.assertEqual(msgs[1].get("id"), "m1")
        self.assertEqual(msgs[1].get("zh"), "B:hello")

    def test_batching_does_not_mix_translators_for_same_key(self) -> None:
        out_q = queue.Queue()
        pump = TranslationPump(translator=_NamedTranslator("A"), emit_update=lambda msg: (out_q.put(msg) or True), batch_size=5, max_queue=50)

        # Low queue batching uses same "key"; translator switch should prevent mixing.
        self.assertEqual(pump.enqueue(mid="m1", text="one", thread_key="k", batchable=True), True)
        pump.set_translator(_NamedTranslator("B"))
        self.assertEqual(pump.enqueue(mid="m2", text="two", thread_key="k", batchable=True), True)

        stop = threading.Event()
        pump.start(stop)
        msgs = _collect(out_q, 2, timeout_s=3.0)
        stop.set()

        by_id = {m.get("id"): m for m in msgs if isinstance(m, dict)}
        self.assertEqual(by_id.get("m1", {}).get("zh"), "A:one")
        self.assertEqual(by_id.get("m2", {}).get("zh"), "B:two")


if __name__ == "__main__":
    unittest.main()
