import os
import tempfile
import unittest
from pathlib import Path

from codex_sidecar.http.sfx import MAX_CUSTOM_SFX_BYTES, list_custom_sfx, read_custom_sfx_bytes


class TestSfxSecurity(unittest.TestCase):
    def test_list_custom_sfx_filters_invalid(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            cfg_home = Path(td)
            sounds = cfg_home / "sounds"
            sounds.mkdir(parents=True, exist_ok=True)

            (sounds / "ding.ogg").write_bytes(b"x" * 16)
            (sounds / "evil.txt").write_bytes(b"x" * 16)
            (sounds / "big.ogg").write_bytes(b"x" * (MAX_CUSTOM_SFX_BYTES + 1))

            items = list_custom_sfx(cfg_home)
            ids = [it.id for it in items]
            self.assertIn("file:ding.ogg", ids)
            self.assertNotIn("file:evil.txt", ids)
            self.assertNotIn("file:big.ogg", ids)

    def test_read_custom_sfx_bytes_rejects_traversal(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            cfg_home = Path(td)
            sounds = cfg_home / "sounds"
            sounds.mkdir(parents=True, exist_ok=True)

            (sounds / "ding.ogg").write_bytes(b"ok")

            data, ct = read_custom_sfx_bytes(cfg_home, "../ding.ogg")
            self.assertIsNone(data)
            self.assertEqual(ct, "")

            data, ct = read_custom_sfx_bytes(cfg_home, "%2e%2e%2fding.ogg")
            self.assertIsNone(data)
            self.assertEqual(ct, "")

            data, ct = read_custom_sfx_bytes(cfg_home, "ding.ogg")
            self.assertEqual(data, b"ok")
            self.assertEqual(ct, "audio/ogg")

    def test_list_custom_sfx_rejects_symlink_outside_root(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            cfg_home = Path(td)
            sounds = cfg_home / "sounds"
            sounds.mkdir(parents=True, exist_ok=True)

            outside_dir = cfg_home / "outside"
            outside_dir.mkdir(parents=True, exist_ok=True)
            outside = outside_dir / "outside.ogg"
            outside.write_bytes(b"ok")

            link = sounds / "link.ogg"
            if hasattr(os, "symlink"):
                try:
                    os.symlink(str(outside), str(link))
                except (OSError, NotImplementedError):
                    self.skipTest("symlink not supported on this platform")
            else:
                self.skipTest("symlink not supported on this platform")

            items = list_custom_sfx(cfg_home)
            ids = [it.id for it in items]
            self.assertNotIn("file:link.ogg", ids)

            data, ct = read_custom_sfx_bytes(cfg_home, "link.ogg")
            self.assertIsNone(data)
            self.assertEqual(ct, "")


if __name__ == "__main__":
    unittest.main()

