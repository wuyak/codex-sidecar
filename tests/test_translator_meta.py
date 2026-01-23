import unittest

from codex_sidecar.control.translator_meta import translator_error, translator_model


class _Tr:
    def __init__(self, *, last_error: str = "", resolved: str = "", model: str = "") -> None:
        self.last_error = last_error
        if resolved:
            self._resolved_model = resolved
        if model:
            self.model = model


class TestTranslatorMeta(unittest.TestCase):
    def test_translator_error_strips_warn_prefix(self) -> None:
        tr = _Tr(last_error="WARN:  token expired ")
        self.assertEqual(translator_error(tr), "token expired")

    def test_translator_model_prefers_resolved_then_model_then_fallback(self) -> None:
        tr1 = _Tr(resolved="r1", model="m1")
        self.assertEqual(translator_model(tr1, "openai"), "r1")
        tr2 = _Tr(model="m2")
        self.assertEqual(translator_model(tr2, "openai"), "m2")
        tr3 = _Tr()
        self.assertEqual(translator_model(tr3, "openai"), "openai")


if __name__ == "__main__":
    unittest.main()

