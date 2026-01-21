import os
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from codex_sidecar.watcher import RolloutWatcher


class _FakeIngest:
    def ingest(self, _msg: dict) -> bool:
        return True


class _FakeTranslator:
    def translate(self, _text: str) -> str:
        return ""


def _mk_rollout(codex_home: Path, *, yyyy: str, mm: str, dd: str, stamp: str, tid: str, mtime: float) -> Path:
    p = codex_home / "sessions" / yyyy / mm / dd
    p.mkdir(parents=True, exist_ok=True)
    fp = p / f"rollout-{stamp}-{tid}.jsonl"
    fp.write_text("", encoding="utf-8")
    os.utime(fp, (mtime, mtime))
    return fp


class TestWatcherFollowExcludes(unittest.TestCase):
    def test_exclude_thread_id_filters_follow_targets(self) -> None:
        with TemporaryDirectory() as td:
            codex_home = Path(td)
            t1 = "11111111-1111-1111-1111-111111111111"
            t2 = "22222222-2222-2222-2222-222222222222"
            t3 = "33333333-3333-3333-3333-333333333333"
            t4 = "44444444-4444-4444-4444-444444444444"

            _mk_rollout(codex_home, yyyy="2026", mm="01", dd="01", stamp="2026-01-01T00-00-00", tid=t1, mtime=100.0)
            _mk_rollout(codex_home, yyyy="2026", mm="01", dd="02", stamp="2026-01-02T00-00-00", tid=t2, mtime=200.0)
            _mk_rollout(codex_home, yyyy="2026", mm="01", dd="03", stamp="2026-01-03T00-00-00", tid=t3, mtime=300.0)
            _mk_rollout(codex_home, yyyy="2026", mm="01", dd="04", stamp="2026-01-04T00-00-00", tid=t4, mtime=400.0)

            w = RolloutWatcher(
                codex_home=codex_home,
                ingest=_FakeIngest(),
                translator=_FakeTranslator(),
                replay_last_lines=0,
                watch_max_sessions=3,
                translate_mode="auto",
                poll_interval_s=0.5,
                file_scan_interval_s=2.0,
                follow_codex_process=False,
                codex_process_regex="codex",
                only_follow_when_process=True,
            )

            w._sync_follow_targets(force=True)
            s0 = w.status()
            f0 = s0.get("follow_files")
            self.assertIsInstance(f0, list)
            self.assertEqual(len(f0), 3)
            self.assertTrue(any(t4 in str(p) for p in f0))

            # Exclude the newest thread id; watcher should backfill with the next file.
            w.set_follow_excludes(keys=[t4])
            w._sync_follow_targets(force=True)
            s1 = w.status()
            f1 = s1.get("follow_files")
            self.assertIsInstance(f1, list)
            self.assertEqual(len(f1), 3)
            self.assertFalse(any(t4 in str(p) for p in f1))


if __name__ == "__main__":
    unittest.main()

