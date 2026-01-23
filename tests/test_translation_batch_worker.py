import unittest

from codex_sidecar.watch.translation_batch_worker import emit_translate_batch


class _Translator:
    def __init__(self, out: str) -> None:
        self._out = out

    def translate(self, _text: str) -> str:
        return self._out


class _StopAfterOne:
    def __init__(self) -> None:
        self._n = 0

    def __call__(self) -> bool:
        self._n += 1
        return self._n > 1


class TestTranslationBatchWorker(unittest.TestCase):
    def test_empty_output_emits_error_without_fallback(self) -> None:
        calls = []
        done = []
        translate_one_calls = {"n": 0}

        def pack(pairs):
            return "PACKED"

        def unpack(_out: str, _wanted):
            return {}

        def translate_one(_text: str):
            translate_one_calls["n"] += 1
            return ("ZH", "E")

        def normalize_err(fallback: str) -> str:
            return f"N:{fallback}"

        def emit_translate(mid: str, zh: str, err: str) -> None:
            calls.append((mid, zh, err))

        def done_id(mid: str) -> None:
            done.append(mid)

        processed = emit_translate_batch(
            translator=_Translator(""),
            pairs=[("a", "x"), ("b", "y")],
            pack_translate_batch=pack,
            unpack_translate_batch=unpack,
            translate_one=translate_one,
            normalize_err=normalize_err,
            emit_translate=emit_translate,
            done_id=done_id,
            stop_requested=lambda: False,
        )

        self.assertEqual(processed, 2)
        self.assertEqual(translate_one_calls["n"], 0)
        self.assertEqual(calls, [("a", "", "N:批量翻译失败"), ("b", "", "N:批量翻译失败")])
        self.assertEqual(done, ["a", "b"])

    def test_missing_item_falls_back_to_per_item(self) -> None:
        calls = []
        done = []
        translate_one_calls = {"n": 0}

        def pack(pairs):
            return "PACKED"

        def unpack(_out: str, _wanted):
            return {"a": "ZA"}

        def translate_one(_text: str):
            translate_one_calls["n"] += 1
            return ("ZB", "E2")

        def normalize_err(fallback: str) -> str:
            return f"N:{fallback}"

        def emit_translate(mid: str, zh: str, err: str) -> None:
            calls.append((mid, zh, err))

        def done_id(mid: str) -> None:
            done.append(mid)

        processed = emit_translate_batch(
            translator=_Translator("OUT"),
            pairs=[("a", "x"), ("b", "y")],
            pack_translate_batch=pack,
            unpack_translate_batch=unpack,
            translate_one=translate_one,
            normalize_err=normalize_err,
            emit_translate=emit_translate,
            done_id=done_id,
            stop_requested=lambda: False,
        )

        self.assertEqual(processed, 2)
        self.assertEqual(translate_one_calls["n"], 1)
        self.assertEqual(calls, [("a", "ZA", ""), ("b", "ZB", "E2")])
        self.assertEqual(done, ["a", "b"])

    def test_stop_requested_interrupts_processing(self) -> None:
        calls = []
        done = []

        def pack(pairs):
            return "PACKED"

        def unpack(_out: str, _wanted):
            return {}

        def translate_one(_text: str):
            return ("ZH", "E")

        def normalize_err(fallback: str) -> str:
            return f"N:{fallback}"

        def emit_translate(mid: str, zh: str, err: str) -> None:
            calls.append((mid, zh, err))

        def done_id(mid: str) -> None:
            done.append(mid)

        processed = emit_translate_batch(
            translator=_Translator(""),
            pairs=[("a", "x"), ("b", "y")],
            pack_translate_batch=pack,
            unpack_translate_batch=unpack,
            translate_one=translate_one,
            normalize_err=normalize_err,
            emit_translate=emit_translate,
            done_id=done_id,
            stop_requested=_StopAfterOne(),
        )

        self.assertEqual(processed, 1)
        self.assertEqual(len(calls), 1)
        self.assertEqual(done, ["a"])


if __name__ == "__main__":
    unittest.main()

