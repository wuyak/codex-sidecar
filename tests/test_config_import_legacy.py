import json
import os
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from codex_sidecar.config import config_path, load_config


class TestConfigImportLegacy(unittest.TestCase):
    def test_imports_from_legacy_home_in_cwd(self) -> None:
        with TemporaryDirectory() as td:
            old_cwd = os.getcwd()
            os.chdir(td)
            try:
                legacy_home = Path(td) / ".codex-thinking-sidecar"
                legacy_home.mkdir(parents=True, exist_ok=True)
                legacy_cfg = legacy_home / "config.json"
                legacy_cfg.write_text(
                    json.dumps(
                        {
                            "config_home": str(legacy_home),
                            "watch_codex_home": str(Path(td) / "codex"),
                            "translator_provider": "openai",
                            "translator_config": {},
                        },
                        ensure_ascii=False,
                        indent=2,
                    )
                    + "\n",
                    encoding="utf-8",
                )

                new_home = Path(td) / "config" / "sidecar"
                cfg = load_config(new_home)
                self.assertEqual(str(cfg.config_home), str(new_home))

                p = config_path(new_home)
                self.assertTrue(p.exists())
                obj = json.loads(p.read_text(encoding="utf-8"))
                self.assertEqual(str(obj.get("config_home") or ""), str(new_home))
            finally:
                os.chdir(old_cwd)

    def test_imports_from_legacy_snapshot_in_codex_home_tmp(self) -> None:
        with TemporaryDirectory() as td:
            old_env = dict(os.environ)
            old_cwd = os.getcwd()
            os.chdir(td)
            try:
                codex_home = Path(td) / "codex"
                os.environ["CODEX_HOME"] = str(codex_home)

                snap_dir = codex_home / "tmp"
                snap_dir.mkdir(parents=True, exist_ok=True)
                snap = snap_dir / "codex_thinking_sidecar.config.json.lastgood"
                snap.write_text(
                    json.dumps(
                        {
                            "config_home": str(Path(td) / "old"),
                            "watch_codex_home": str(codex_home),
                            "translator_provider": "openai",
                            "translator_config": {},
                        },
                        ensure_ascii=False,
                        indent=2,
                    )
                    + "\n",
                    encoding="utf-8",
                )

                new_home = Path(td) / "config" / "sidecar"
                cfg = load_config(new_home)
                self.assertEqual(str(cfg.config_home), str(new_home))

                p = config_path(new_home)
                self.assertTrue(p.exists())
                obj = json.loads(p.read_text(encoding="utf-8"))
                self.assertEqual(str(obj.get("config_home") or ""), str(new_home))
            finally:
                os.environ.clear()
                os.environ.update(old_env)
                os.chdir(old_cwd)


if __name__ == "__main__":
    unittest.main()

