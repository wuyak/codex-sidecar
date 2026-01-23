import unittest

from codex_sidecar.translators.batch_prompt import looks_like_translate_batch_prompt


class TestTranslatorsBatchPrompt(unittest.TestCase):
    def test_detects_packed_prompt(self) -> None:
        s = "\n".join(
            [
                "header",
                "<<<SIDECAR_TRANSLATE_BATCH_V1>>>",
                "<<<SIDECAR_ITEM:a>>>",
                "hello",
                "<<<SIDECAR_END>>>",
            ]
        )
        self.assertEqual(looks_like_translate_batch_prompt(s), True)

    def test_rejects_normal_text(self) -> None:
        self.assertEqual(looks_like_translate_batch_prompt("hello"), False)
        self.assertEqual(looks_like_translate_batch_prompt("<<<SIDECAR_ITEM:a>>>"), False)


if __name__ == "__main__":
    unittest.main()

