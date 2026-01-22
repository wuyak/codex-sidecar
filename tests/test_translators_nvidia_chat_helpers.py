import unittest

from codex_sidecar.translators.nvidia_chat_helpers import (
    _extract_context_limit_hint,
    _extract_error_detail,
    _has_md_heading,
    _looks_like_untranslated_output,
    _parse_retry_after_s,
    _violates_markdown_preservation,
)


class TestTranslatorsNvidiaChatHelpers(unittest.TestCase):
    def test_parse_retry_after_s(self) -> None:
        self.assertEqual(_parse_retry_after_s(""), 0.0)
        self.assertEqual(_parse_retry_after_s("  "), 0.0)
        self.assertEqual(_parse_retry_after_s("2"), 2.0)
        self.assertEqual(_parse_retry_after_s("2.5"), 2.5)
        self.assertEqual(_parse_retry_after_s("-1"), 0.0)
        self.assertEqual(_parse_retry_after_s("abc"), 0.0)

    def test_extract_error_detail(self) -> None:
        self.assertEqual(_extract_error_detail(None), "")
        self.assertEqual(_extract_error_detail({"error": "nope"}), "nope")
        self.assertEqual(_extract_error_detail({"message": "m"}), "m")
        self.assertEqual(_extract_error_detail({"detail": "d"}), "d")
        self.assertEqual(
            _extract_error_detail({"error": {"code": 401, "message": "unauthorized"}}),
            "code=401 unauthorized",
        )

    def test_has_md_heading_ignores_code_fence(self) -> None:
        s = "\n".join(
            [
                "```",
                "# in code",
                "```",
                "not heading",
            ]
        )
        self.assertEqual(_has_md_heading(s), False)
        self.assertEqual(_has_md_heading("# title"), True)

    def test_violates_markdown_preservation(self) -> None:
        src = "# Title\n\nhello"
        out = "标题\n\n你好"
        self.assertEqual(_violates_markdown_preservation(src, out), True)

        src2 = "```bash\necho hi\n```"
        out2 = "echo hi"
        self.assertEqual(_violates_markdown_preservation(src2, out2), True)

        # Batch prompt should skip the Markdown preservation gate.
        packed = "\n".join(
            [
                "header",
                "<<<SIDECAR_TRANSLATE_BATCH_V1>>>",
                "<<<SIDECAR_ITEM:a>>>",
                "# Title",
                "<<<SIDECAR_END>>>",
            ]
        )
        self.assertEqual(_violates_markdown_preservation(packed, "whatever"), False)

    def test_extract_context_limit_hint(self) -> None:
        raw = (
            b'{"error":{"message":"This model\\u0027s maximum context length is 4096 tokens. '
            b'However, you requested 8224 tokens (32 in the messages, 8192 in the completion)."}}'
        )
        self.assertEqual(_extract_context_limit_hint(raw), (4096, 32))
        self.assertEqual(_extract_context_limit_hint(b""), (0, 0))

    def test_looks_like_untranslated_output(self) -> None:
        self.assertEqual(_looks_like_untranslated_output("Translate the following..."), True)
        self.assertEqual(_looks_like_untranslated_output("这是中文翻译。"), False)


if __name__ == "__main__":
    unittest.main()

