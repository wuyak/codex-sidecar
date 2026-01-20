import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from codex_sidecar.offline import build_offline_messages, offline_key_from_rel, resolve_offline_rollout_path


class TestOffline(unittest.TestCase):
    def test_offline_key_from_rel_encodes_slashes(self) -> None:
        rel = "sessions/2026/01/20/rollout-2026-01-20T23-44-00-01234567-89ab-cdef-0123-456789abcdef.jsonl"
        self.assertEqual(
            offline_key_from_rel(rel),
            "offline:sessions%2F2026%2F01%2F20%2Frollout-2026-01-20T23-44-00-01234567-89ab-cdef-0123-456789abcdef.jsonl",
        )
        # Backslash + leading slash normalization.
        rel2 = "/sessions\\2026\\01\\20\\rollout-2026-01-20T23-44-00-01234567-89ab-cdef-0123-456789abcdef.jsonl"
        self.assertEqual(offline_key_from_rel(rel2), offline_key_from_rel(rel))

    def test_resolve_offline_rollout_path_security(self) -> None:
        with TemporaryDirectory() as td:
            base = Path(td)
            p = base / "sessions" / "2026" / "01" / "20"
            p.mkdir(parents=True, exist_ok=True)
            name = "rollout-2026-01-20T23-44-00-01234567-89ab-cdef-0123-456789abcdef.jsonl"
            good = p / name
            good.write_text("{}", encoding="utf-8")

            rel = "sessions/2026/01/20/" + name
            hit = resolve_offline_rollout_path(base, rel)
            self.assertIsNotNone(hit)
            self.assertEqual(Path(str(hit)).resolve(), good.resolve())

            self.assertIsNone(resolve_offline_rollout_path(base, "not_sessions/" + name))
            self.assertIsNone(resolve_offline_rollout_path(base, "../" + name))
            self.assertIsNone(resolve_offline_rollout_path(base, "sessions/../" + name))
            self.assertIsNone(resolve_offline_rollout_path(base, "sessions/2026/01/20/rollout-bad.jsonl"))

    def test_build_offline_messages_id_and_key(self) -> None:
        with TemporaryDirectory() as td:
            base = Path(td)
            p = base / "sessions" / "2026" / "01" / "20"
            p.mkdir(parents=True, exist_ok=True)
            name = "rollout-2026-01-20T23-44-00-01234567-89ab-cdef-0123-456789abcdef.jsonl"
            file_path = p / name
            obj = {
                "timestamp": "2026-01-20T23:00:00Z",
                "type": "event_msg",
                "payload": {"type": "user_message", "message": "hi"},
            }
            raw = json.dumps(obj, ensure_ascii=False, separators=(",", ":"))
            file_path.write_text(raw + "\n", encoding="utf-8")

            rel = "sessions/2026/01/20/" + name
            off_key = offline_key_from_rel(rel)
            msgs = build_offline_messages(rel=rel, file_path=file_path, tail_lines=50, offline_key=off_key)
            self.assertEqual(len(msgs), 1)
            m = msgs[0]
            self.assertTrue(str(m.get("id", "")).startswith(f"off:{off_key}:"))
            self.assertEqual(m.get("key"), off_key)
            self.assertEqual(m.get("thread_id"), "01234567-89ab-cdef-0123-456789abcdef")
            self.assertEqual(m.get("replay"), True)
            self.assertEqual(m.get("kind"), "user_message")
            self.assertEqual(m.get("text"), "hi")


if __name__ == "__main__":
    unittest.main()

