import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from codex_sidecar.config import SidecarConfig
from codex_sidecar.control.config_patch import apply_config_patch


class TestControlConfigPatch(unittest.TestCase):
    def test_translator_config_one_level_merge_preserves_other_provider(self) -> None:
        with TemporaryDirectory() as td:
            cfg = SidecarConfig.from_dict(
                {
                    "config_home": td,
                    "watch_codex_home": td,
                    "translator_provider": "openai",
                    "translator_config": {
                        "openai": {"base_url": "https://example.invalid", "api_key": "OLD"},
                        "http": {
                            "profiles": [
                                {"name": "p1", "url": "http://127.0.0.1:1", "token": ""},
                            ],
                            "selected": "p1",
                        },
                    },
                }
            )

            res = apply_config_patch(
                current_cfg=cfg,
                config_home=Path(td),
                patch={"translator_config": {"openai": {"api_key": "NEW"}}},
                allow_empty_translator_config=False,
            )

            out = res.out
            self.assertEqual(str(out.get("config_home") or ""), str(Path(td)))
            tc = out.get("translator_config")
            self.assertIsInstance(tc, dict)
            self.assertIn("http", tc)
            self.assertEqual(tc.get("http", {}).get("selected"), "p1")

    def test_http_provider_rejects_empty_profiles_by_default(self) -> None:
        with TemporaryDirectory() as td:
            cfg = SidecarConfig.from_dict(
                {
                    "config_home": td,
                    "watch_codex_home": td,
                    "translator_provider": "openai",
                    "translator_config": {
                        "http": {
                            "profiles": [
                                {"name": "p1", "url": "http://127.0.0.1:1", "token": ""},
                            ],
                            "selected": "p1",
                        }
                    },
                }
            )

            with self.assertRaises(ValueError):
                apply_config_patch(
                    current_cfg=cfg,
                    config_home=Path(td),
                    patch={
                        "translator_provider": "http",
                        "translator_config": {"http": {"profiles": [], "selected": ""}},
                    },
                    allow_empty_translator_config=False,
                )

            # Explicitly allow empty translator config: should not raise.
            res2 = apply_config_patch(
                current_cfg=cfg,
                config_home=Path(td),
                patch={
                    "translator_provider": "http",
                    "translator_config": {"http": {"profiles": [], "selected": ""}},
                },
                allow_empty_translator_config=True,
            )
            self.assertEqual(str(res2.cfg.translator_provider or ""), "http")


if __name__ == "__main__":
    unittest.main()

