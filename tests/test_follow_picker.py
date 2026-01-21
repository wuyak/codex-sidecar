import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from codex_sidecar.watch.follow_picker import FollowPicker


class TestFollowPicker(unittest.TestCase):
    def test_pick_pinned_without_process_follow(self) -> None:
        with TemporaryDirectory() as td:
            base = Path(td)
            p = base / "sessions" / "2026" / "01" / "20"
            p.mkdir(parents=True, exist_ok=True)
            name = "rollout-2026-01-20T23-44-00-01234567-89ab-cdef-0123-456789abcdef.jsonl"
            f = p / name
            f.write_text("{}", encoding="utf-8")

            fp = FollowPicker(
                codex_home=base,
                follow_codex_process=False,
                codex_process_regex="codex",
                only_follow_when_process=True,
            )

            picked = fp.pick(selection_mode="pin", pinned_thread_id="", pinned_file=f)
            self.assertIsNotNone(picked.picked)
            self.assertEqual(Path(str(picked.picked)).resolve(), f.resolve())
            self.assertEqual(picked.thread_id, "01234567-89ab-cdef-0123-456789abcdef")
            self.assertEqual(picked.follow_mode, "pinned")
            self.assertEqual(picked.codex_detected, False)


if __name__ == "__main__":
    unittest.main()

