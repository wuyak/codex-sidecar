import unittest

from codex_sidecar.control.follow_control_api import (
    NormalizedFollow,
    apply_follow_excludes_to_watcher,
    apply_follow_to_watcher,
    normalize_follow,
    normalize_follow_excludes,
)


class _FakeWatcher:
    def __init__(self) -> None:
        self.follow_calls = []
        self.exclude_calls = []

    def set_follow(self, mode: str, *, thread_id: str = "", file: str = "") -> None:
        self.follow_calls.append((mode, str(thread_id), str(file)))

    def set_follow_excludes(self, *, keys, files) -> None:
        self.exclude_calls.append((list(keys), list(files)))


class TestFollowControlApi(unittest.TestCase):
    def test_normalize_follow_defaults_to_auto(self) -> None:
        f = normalize_follow("bad", thread_id=" t ", file=" f ")
        self.assertIsInstance(f, NormalizedFollow)
        self.assertEqual(f.mode, "auto")
        self.assertEqual(f.thread_id, "t")
        self.assertEqual(f.file, "f")

    def test_normalize_follow_excludes_trims_and_limits(self) -> None:
        long_key = "x" * 400
        long_file = "y" * 3000
        keys, files = normalize_follow_excludes(keys=[" a ", "", None, long_key], files=[" f ", "", None, long_file])  # type: ignore[list-item]
        self.assertIn("a", keys)
        self.assertIn("x" * 256, keys)
        self.assertNotIn(long_key, keys)
        self.assertIn("f", files)
        self.assertIn("y" * 2048, files)
        self.assertNotIn(long_file, files)

    def test_apply_follow_to_watcher_calls_set_follow(self) -> None:
        w = _FakeWatcher()
        apply_follow_to_watcher(w, NormalizedFollow(mode="pin", thread_id="tid", file="/x"))
        self.assertEqual(w.follow_calls, [("pin", "tid", "/x")])

    def test_apply_follow_excludes_to_watcher_calls_set_follow_excludes(self) -> None:
        w = _FakeWatcher()
        apply_follow_excludes_to_watcher(w, keys={"a"}, files={"b"})
        self.assertEqual(len(w.exclude_calls), 1)
        keys, files = w.exclude_calls[0]
        self.assertIn("a", keys)
        self.assertIn("b", files)


if __name__ == "__main__":
    unittest.main()

