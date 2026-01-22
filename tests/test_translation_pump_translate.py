import unittest

from codex_sidecar.watch.translation_pump_translate import normalize_translate_error, translate_one


class _OkTranslator:
    last_error = ""

    def translate(self, text: str) -> str:
        return "ZH:" + str(text)


class _EmptyTranslator:
    def __init__(self, last_error: str) -> None:
        self.last_error = last_error

    def translate(self, _text: str) -> str:
        return ""


class _BoomTranslator:
    last_error = "WARN:should_not_leak"

    def translate(self, _text: str) -> str:
        raise RuntimeError("boom")


class TestTranslationPumpTranslate(unittest.TestCase):
    def test_translate_one_empty_text(self) -> None:
        zh, err = translate_one(_OkTranslator(), "")
        self.assertEqual(zh, "")
        self.assertEqual(err, "")

    def test_translate_one_exception(self) -> None:
        zh, err = translate_one(_BoomTranslator(), "hi")
        self.assertEqual(zh, "")
        self.assertIn("翻译异常：", err)

    def test_translate_one_empty_output_uses_normalized_error(self) -> None:
        tr = _EmptyTranslator("WARN:  token expired ")
        zh, err = translate_one(tr, "hi")
        self.assertEqual(zh, "")
        self.assertEqual(err, "token expired")

    def test_normalize_translate_error_truncates(self) -> None:
        tr = _EmptyTranslator("x" * 400)
        err = normalize_translate_error(tr, "fallback")
        self.assertTrue(err.endswith("…"))
        self.assertLessEqual(len(err), 241)


if __name__ == "__main__":
    unittest.main()

