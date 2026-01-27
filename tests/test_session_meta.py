import tempfile
import unittest
from pathlib import Path

from codex_sidecar.watch.session_meta import read_session_source_meta


class TestSessionMeta(unittest.TestCase):
    def _tmp(self, text: str) -> Path:
        d = tempfile.TemporaryDirectory()
        self.addCleanup(d.cleanup)
        p = Path(d.name) / "rollout.jsonl"
        p.write_text(text, encoding="utf-8")
        return p

    def test_source_cli(self) -> None:
        p = self._tmp('{"type":"session_meta","payload":{"source":"cli"}}\n{"type":"event_msg","payload":{"type":"user_message","message":"hi"}}\n')
        meta = read_session_source_meta(p)
        self.assertEqual(meta.get("source_kind"), "cli")
        self.assertNotIn("parent_thread_id", meta)

    def test_source_subagent_parent(self) -> None:
        p = self._tmp(
            '{"type":"session_meta","payload":{"source":{"subagent":{"thread_spawn":{"parent_thread_id":"019bf9d1-xxxx","depth":1}}}}}\n'
        )
        meta = read_session_source_meta(p)
        self.assertEqual(meta.get("source_kind"), "subagent")
        self.assertEqual(meta.get("parent_thread_id"), "019bf9d1-xxxx")
        self.assertEqual(meta.get("subagent_depth"), 1)

    def test_missing_session_meta(self) -> None:
        p = self._tmp('{"type":"event_msg","payload":{"type":"user_message","message":"hi"}}\n')
        meta = read_session_source_meta(p)
        self.assertEqual(meta, {})


if __name__ == "__main__":
    unittest.main()

