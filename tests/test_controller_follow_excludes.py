import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from codex_sidecar.controller import SidecarController
from codex_sidecar.http.state import SidecarState


class TestControllerFollowExcludes(unittest.TestCase):
    def test_set_follow_excludes_cleans_and_limits(self) -> None:
        with TemporaryDirectory() as td:
            st = SidecarState(max_messages=10)
            ctl = SidecarController(config_home=Path(td), server_url="http://127.0.0.1:1", state=st)

            long_key = "x" * 400
            long_file = "y" * 3000
            r = ctl.set_follow_excludes(keys=[" a ", "", None, long_key], files=[" f ", "", None, long_file])  # type: ignore[list-item]

            self.assertEqual(r.get("ok"), True)
            self.assertIn("a", r.get("exclude_keys"))
            self.assertIn("x" * 256, r.get("exclude_keys"))
            self.assertNotIn(long_key, r.get("exclude_keys"))

            self.assertIn("f", r.get("exclude_files"))
            self.assertIn("y" * 2048, r.get("exclude_files"))
            self.assertNotIn(long_file, r.get("exclude_files"))

            with ctl._lock:
                self.assertIn("a", ctl._follow_exclude_keys)
                self.assertIn("x" * 256, ctl._follow_exclude_keys)
                self.assertIn("f", ctl._follow_exclude_files)
                self.assertIn("y" * 2048, ctl._follow_exclude_files)


if __name__ == "__main__":
    unittest.main()

