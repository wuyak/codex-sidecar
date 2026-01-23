import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from codex_sidecar.controller import SidecarController
from codex_sidecar.http.state import SidecarState


class _FakeTranslator:
    def __init__(self, *, out: str, model: str = "fake-model", last_error: str = "") -> None:
        self._out = out
        self.model = model
        self.last_error = last_error

    def translate(self, text: str) -> str:
        return self._out.replace("{text}", str(text))


class TestControllerTranslate(unittest.TestCase):
    def test_translate_text_uses_translator_output(self) -> None:
        with TemporaryDirectory() as td:
            st = SidecarState(max_messages=10)
            ctl = SidecarController(config_home=Path(td), server_url="http://127.0.0.1:1", state=st)
            with patch("codex_sidecar.controller.build_translator", return_value=_FakeTranslator(out="ZH:{text}")):
                r = ctl.translate_text("hi")
            self.assertEqual(r.get("ok"), True)
            self.assertEqual(r.get("zh"), "ZH:hi")
            self.assertIn("ms", r)

    def test_translate_text_empty_text(self) -> None:
        with TemporaryDirectory() as td:
            st = SidecarState(max_messages=10)
            ctl = SidecarController(config_home=Path(td), server_url="http://127.0.0.1:1", state=st)
            r = ctl.translate_text("   ")
            self.assertEqual(r.get("ok"), False)
            self.assertEqual(r.get("error"), "empty_text")

    def test_translate_items_shape_and_per_item_error(self) -> None:
        with TemporaryDirectory() as td:
            st = SidecarState(max_messages=10)
            ctl = SidecarController(config_home=Path(td), server_url="http://127.0.0.1:1", state=st)
            with patch(
                "codex_sidecar.controller.build_translator",
                return_value=_FakeTranslator(out="", last_error="WARN: upstream temporary"),
            ):
                r = ctl.translate_items([{"id": "a", "text": "x"}])
            self.assertEqual(r.get("ok"), True)
            items = r.get("items")
            self.assertIsInstance(items, list)
            self.assertEqual(items[0].get("id"), "a")
            self.assertEqual(items[0].get("ok"), False)
            # WARN prefix is stripped.
            self.assertEqual(items[0].get("error"), "upstream temporary")

    def test_translate_probe_unknown_provider(self) -> None:
        with TemporaryDirectory() as td:
            st = SidecarState(max_messages=10)
            ctl = SidecarController(config_home=Path(td), server_url="http://127.0.0.1:1", state=st)
            with ctl._lock:
                ctl._cfg.translator_provider = "bad"
            r = ctl.translate_probe()
            self.assertEqual(r.get("ok"), False)
            self.assertEqual(r.get("error"), "unknown_provider")


if __name__ == "__main__":
    unittest.main()
