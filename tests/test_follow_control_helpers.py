import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from codex_sidecar.watch.follow_control_helpers import clean_exclude_files, clean_exclude_keys, resolve_pinned_rollout_file
from codex_sidecar.watch.rollout_paths import _ROLLOUT_RE


class TestFollowControlHelpers(unittest.TestCase):
    def test_clean_exclude_keys_trims_and_limits(self) -> None:
        keys = [" a ", "", None, "x" * 400]
        out = clean_exclude_keys(keys, max_items=10, max_len=256)
        self.assertIn("a", out)
        self.assertIn("x" * 256, out)
        self.assertNotIn("x" * 400, out)

    def test_clean_exclude_files_filters_to_sessions_rollout_only(self) -> None:
        with TemporaryDirectory() as td:
            codex_home = Path(td) / "codex"
            sessions = codex_home / "sessions" / "2026" / "01" / "22"
            sessions.mkdir(parents=True, exist_ok=True)
            ok = sessions / "rollout-2026-01-22T00-00-00-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.jsonl"
            ok.write_text("{}", encoding="utf-8")
            bad = sessions / "not-rollout.txt"
            bad.write_text("x", encoding="utf-8")

            outside = Path(td) / "outside" / "sessions" / "2026" / "01" / "22"
            outside.mkdir(parents=True, exist_ok=True)
            out_roll = outside / "rollout-2026-01-22T00-00-01-bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb.jsonl"
            out_roll.write_text("{}", encoding="utf-8")

            raw = [str(ok), str(bad), str(out_roll), "missing.jsonl"]
            got = clean_exclude_files(raw, codex_home=codex_home, rollout_re=_ROLLOUT_RE, max_items=1000)
            self.assertEqual({p.resolve() for p in got}, {ok.resolve()})

    def test_resolve_pinned_rollout_file_prefers_valid_file_path(self) -> None:
        with TemporaryDirectory() as td:
            codex_home = Path(td) / "codex"
            sessions = codex_home / "sessions" / "2026" / "01" / "22"
            sessions.mkdir(parents=True, exist_ok=True)
            ok = sessions / "rollout-2026-01-22T00-00-00-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.jsonl"
            ok.write_text("{}", encoding="utf-8")

            called = {"n": 0}

            def _find(_home: Path, _tid: str) -> Path:
                called["n"] += 1
                return ok

            r = resolve_pinned_rollout_file(
                codex_home,
                file_path=str(ok),
                thread_id="aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
                find_rollout_file_for_thread=_find,
                rollout_re=_ROLLOUT_RE,
            )
            self.assertEqual(Path(str(r)).resolve(), ok.resolve())
            self.assertEqual(called["n"], 0)

    def test_resolve_pinned_rollout_file_falls_back_to_thread_id(self) -> None:
        with TemporaryDirectory() as td:
            codex_home = Path(td) / "codex"
            sessions = codex_home / "sessions" / "2026" / "01" / "22"
            sessions.mkdir(parents=True, exist_ok=True)
            ok = sessions / "rollout-2026-01-22T00-00-00-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.jsonl"
            ok.write_text("{}", encoding="utf-8")

            def _find(_home: Path, _tid: str) -> Path:
                return ok

            # file_path is outside sessions_root -> should be ignored and fall back to thread_id.
            outside = Path(td) / "outside.jsonl"
            outside.write_text("{}", encoding="utf-8")
            r = resolve_pinned_rollout_file(
                codex_home,
                file_path=str(outside),
                thread_id="aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
                find_rollout_file_for_thread=_find,
                rollout_re=_ROLLOUT_RE,
            )
            self.assertEqual(Path(str(r)).resolve(), ok.resolve())


if __name__ == "__main__":
    unittest.main()
