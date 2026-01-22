import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from codex_sidecar.config import config_path, load_config


class TestConfigLoadMigrations(unittest.TestCase):
    def test_replay_last_lines_migrates_to_200_and_persists(self) -> None:
        with TemporaryDirectory() as td:
            home = Path(td)
            p = config_path(home)
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(
                json.dumps(
                    {
                        "config_home": str(home),
                        "watch_codex_home": str(home),
                        "replay_last_lines": 0,
                        "translator_provider": "openai",
                        "translator_config": {},
                    },
                    ensure_ascii=False,
                    indent=2,
                )
                + "\n",
                encoding="utf-8",
            )

            cfg = load_config(home)
            self.assertEqual(int(cfg.replay_last_lines), 200)

            obj = json.loads(p.read_text(encoding="utf-8"))
            self.assertEqual(int(obj.get("replay_last_lines") or 0), 200)

    def test_stub_provider_migrates_to_openai_and_keeps_other_configs(self) -> None:
        with TemporaryDirectory() as td:
            home = Path(td)
            p = config_path(home)
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(
                json.dumps(
                    {
                        "config_home": str(home),
                        "watch_codex_home": str(home),
                        "translator_provider": "stub",
                        "translator_config": {
                            "http": {"profiles": [{"name": "p1", "url": "http://127.0.0.1:1"}]},
                        },
                    },
                    ensure_ascii=False,
                    indent=2,
                )
                + "\n",
                encoding="utf-8",
            )

            cfg = load_config(home)
            self.assertEqual(str(cfg.translator_provider or ""), "openai")
            self.assertIsInstance(cfg.translator_config, dict)
            self.assertIn("http", cfg.translator_config)

            obj = json.loads(p.read_text(encoding="utf-8"))
            self.assertEqual(str(obj.get("translator_provider") or ""), "openai")
            tc = obj.get("translator_config")
            self.assertIsInstance(tc, dict)
            self.assertIn("http", tc)

    def test_nvidia_model_is_corrected_to_allowed_default(self) -> None:
        with TemporaryDirectory() as td:
            home = Path(td)
            p = config_path(home)
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(
                json.dumps(
                    {
                        "config_home": str(home),
                        "watch_codex_home": str(home),
                        "translator_provider": "nvidia",
                        "translator_config": {"nvidia": {"model": "bad-model-id"}},
                    },
                    ensure_ascii=False,
                    indent=2,
                )
                + "\n",
                encoding="utf-8",
            )

            cfg = load_config(home)
            nv = cfg.translator_config.get("nvidia") if isinstance(cfg.translator_config, dict) else None
            self.assertIsInstance(nv, dict)
            self.assertEqual(str(nv.get("model") or ""), "moonshotai/kimi-k2-instruct")

            obj = json.loads(p.read_text(encoding="utf-8"))
            nv2 = obj.get("translator_config", {}).get("nvidia")
            self.assertEqual(str(nv2.get("model") or ""), "moonshotai/kimi-k2-instruct")


if __name__ == "__main__":
    unittest.main()

