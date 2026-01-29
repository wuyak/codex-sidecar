import json
import unittest
import urllib.parse
from unittest.mock import patch

from codex_sidecar.translators.http import HttpTranslator


class _FakeResp:
    def __init__(self, body: bytes, *, headers=None):
        self._body = body
        self.headers = headers or {"Content-Type": "application/json"}

    def read(self) -> bytes:
        return self._body

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False


class TestHttpTranslatorGoogle(unittest.TestCase):
    def test_google_pa_translates_and_skips_auth_header(self) -> None:
        seen = {}

        def _urlopen(req, timeout=0.0):
            seen["req"] = req
            seen["timeout"] = timeout
            body = json.dumps({"translation": "你好世界！"}, ensure_ascii=False).encode("utf-8")
            return _FakeResp(body)

        tr = HttpTranslator(
            url="https://translate-pa.googleapis.com/v1/translate?from=auto&to=zh-CN",
            timeout_s=9.0,
            auth_token="SHOULD_NOT_BE_SENT",
        )
        with patch("codex_sidecar.translators.http.urllib.request.urlopen", _urlopen):
            out = tr.translate("Hello world!")

        self.assertEqual(out, "你好世界！")

        req = seen.get("req")
        self.assertIsNotNone(req)
        self.assertEqual(req.get_method(), "GET")

        parsed = urllib.parse.urlsplit(req.full_url)
        self.assertEqual(parsed.netloc, "translate-pa.googleapis.com")
        self.assertEqual(parsed.path, "/v1/translate")
        qs = urllib.parse.parse_qs(parsed.query)
        self.assertEqual(qs.get("query.text"), ["Hello world!"])
        self.assertEqual(qs.get("query.source_language"), ["auto"])
        self.assertEqual(qs.get("query.target_language"), ["zh-CN"])

        # Auth header must be skipped for this endpoint.
        headers = {k.lower(): v for k, v in req.header_items()}
        self.assertTrue(headers.get("accept-encoding", "").lower().startswith("identity"))
        self.assertFalse("authorization" in headers)

    def test_google_a_extracts_sentences_trans(self) -> None:
        def _urlopen(req, timeout=0.0):
            body = json.dumps(
                {"sentences": [{"trans": "你好"}, {"trans": "世界"}]},
                ensure_ascii=False,
            ).encode("utf-8")
            return _FakeResp(body)

        tr = HttpTranslator(url="https://translate.googleapis.com/translate_a/single?sl=auto&tl=zh-CN", timeout_s=9.0)
        with patch("codex_sidecar.translators.http.urllib.request.urlopen", _urlopen):
            out = tr.translate("Hello world!")

        self.assertEqual(out, "你好世界")

    def test_google_a_uses_post_for_long_text(self) -> None:
        seen = {}

        def _urlopen(req, timeout=0.0):
            seen["req"] = req
            body = json.dumps({"sentences": [{"trans": "OK"}]}, ensure_ascii=False).encode("utf-8")
            return _FakeResp(body)

        tr = HttpTranslator(url="https://translate.googleapis.com/translate_a/single?sl=auto&tl=zh-CN", timeout_s=9.0)
        long = "x" * 2000
        with patch("codex_sidecar.translators.http.urllib.request.urlopen", _urlopen):
            out = tr.translate(long)

        self.assertEqual(out, "OK")
        req = seen.get("req")
        self.assertIsNotNone(req)
        self.assertEqual(req.get_method(), "POST")

    def test_googlefree_preserves_markdown_structure(self) -> None:
        # Google endpoints may reflow markdown (extra blank lines, code fences spacing, etc).
        # For the built-in "googlefree" profile we preserve the original line/blank/code layout.
        md = (
            "# Title\n"
            "\n"
            "- Item A\n"
            "- Item B with `inline_code` and URL https://example.com\n"
            "\n"
            "```bash\n"
            "echo \"Hello\" && ls -la\n"
            "```\n"
            "\n"
            "Paragraph with **bold** and _italic_.\n"
        )

        # Simulate a "messy" translation output: only some marker lines are present, with extra blanks.
        translated = (
            "[[SC_L000001]]标题\n"
            "\n"
            "\n"
            "[[SC_L000003]]项目 A\n"
            "\n"
            "[[SC_L000004]]项目 B with [[SC_IC0001]] and URL [[SC_URL0001]]\n"
            "\n"
            "\n"
            "[[SC_L000010]]段落 with **bold** and _italic_.\n"
        )

        def _urlopen(req, timeout=0.0):
            body = json.dumps({"translation": translated}, ensure_ascii=False).encode("utf-8")
            return _FakeResp(body)

        tr = HttpTranslator(
            url="https://translate-pa.googleapis.com/v1/translate?from=auto&to=zh-CN",
            timeout_s=9.0,
            profile_name="googlefree",
        )
        with patch("codex_sidecar.translators.http.urllib.request.urlopen", _urlopen):
            out = tr.translate(md)

        expect = (
            "# 标题\n"
            "\n"
            "- 项目 A\n"
            "- 项目 B with `inline_code` and URL https://example.com\n"
            "\n"
            "```bash\n"
            "echo \"Hello\" && ls -la\n"
            "```\n"
            "\n"
            "段落 with **bold** and _italic_.\n"
        )
        self.assertEqual(out, expect)
