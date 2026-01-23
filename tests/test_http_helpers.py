import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from codex_sidecar.http.config_payload import apply_config_display_fields, build_config_payload, decorate_status_payload
from codex_sidecar.http.json_helpers import parse_json_object


class TestHttpJsonHelpers(unittest.TestCase):
    def test_parse_json_object_ok(self) -> None:
        obj, err = parse_json_object(b"{\"a\":1}", allow_invalid_json=False)
        self.assertEqual(err, "")
        self.assertEqual(obj, {"a": 1})

    def test_parse_json_object_invalid_json_strict(self) -> None:
        obj, err = parse_json_object(b"{bad", allow_invalid_json=False)
        self.assertEqual(obj, None)
        self.assertEqual(err, "invalid_json")

    def test_parse_json_object_invalid_json_compat(self) -> None:
        obj, err = parse_json_object(b"{bad", allow_invalid_json=True)
        self.assertEqual(err, "")
        self.assertEqual(obj, {})

    def test_parse_json_object_rejects_non_object(self) -> None:
        raw = json.dumps([1, 2, 3]).encode("utf-8")
        obj, err = parse_json_object(raw, allow_invalid_json=False)
        self.assertEqual(obj, None)
        self.assertEqual(err, "invalid_payload")


class TestHttpConfigPayload(unittest.TestCase):
    def test_apply_config_display_fields_uses_project_relative(self) -> None:
        with TemporaryDirectory() as td:
            cwd = Path(td) / "proj"
            cwd.mkdir(parents=True, exist_ok=True)
            cfg_home = cwd / "config" / "sidecar"
            cfg = {"config_home": str(cfg_home)}
            apply_config_display_fields(cfg, cwd=cwd)
            self.assertEqual(str(cfg.get("config_home_display")).replace("\\", "/"), "config/sidecar")
            self.assertEqual(str(cfg.get("config_file_display")).replace("\\", "/"), "config/sidecar/config.json")

    def test_build_config_payload_spreads_top_level(self) -> None:
        with TemporaryDirectory() as td:
            cwd = Path(td) / "proj"
            cwd.mkdir(parents=True, exist_ok=True)
            cfg = {"config_home": str(cwd / "config" / "sidecar"), "translate_mode": "auto"}
            payload = build_config_payload(cfg, cwd=cwd)
            self.assertEqual(payload.get("ok"), True)
            self.assertIsInstance(payload.get("config"), dict)
            self.assertEqual(payload.get("translate_mode"), "auto")
            self.assertIn("config_home_display", payload.get("config"))

    def test_decorate_status_payload_redacts_and_adds_display(self) -> None:
        with TemporaryDirectory() as td:
            cwd = Path(td) / "proj"
            cwd.mkdir(parents=True, exist_ok=True)
            st = {"ok": True, "config": {"config_home": str(cwd / "config" / "sidecar")}}
            out = decorate_status_payload(st, cwd=cwd)
            self.assertIs(out, st)
            cfg = out.get("config")
            self.assertIsInstance(cfg, dict)
            self.assertIn("config_home_display", cfg)


if __name__ == "__main__":
    unittest.main()

