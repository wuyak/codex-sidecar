import unittest

from codex_sidecar.watch.tui_gate_helpers import format_tool_gate_md, parse_toolcall, split_ts


class TestTuiGateHelpers(unittest.TestCase):
    def test_split_ts(self) -> None:
        ts, msg = split_ts("2026-01-14T12:34:56.123Z  INFO waiting for tool gate")
        self.assertEqual(ts, "2026-01-14T12:34:56.123Z")
        self.assertEqual(msg, "INFO waiting for tool gate")

        ts2, msg2 = split_ts("INFO tool gate released")
        self.assertEqual(ts2, "")
        self.assertEqual(msg2, "INFO tool gate released")

    def test_parse_toolcall_json_payload(self) -> None:
        tc = parse_toolcall('INFO ToolCall: shell {"command":["echo","hi"],"justification":"Bearer abcdefghijklmnop"}')
        self.assertIsNotNone(tc)
        assert tc is not None
        self.assertEqual(tc.get("tool"), "shell")
        self.assertIsInstance(tc.get("payload"), dict)
        self.assertIn("command", tc.get("payload") or {})

    def test_format_tool_gate_md_redaction(self) -> None:
        toolcall = {
            "tool": "shell",
            "payload": {
                "justification": "Bearer abcdefghijklmnop sk-1234567890abcdef",
                "command": ["echo", "sk-1234567890abcdef", "Bearer", "abcdefghijklmnop"],
            },
            "raw": "",
        }
        md = format_tool_gate_md(waiting=True, toolcall=toolcall, synthetic=False)
        self.assertIn("⏸️ 终端等待确认（tool gate）", md)
        self.assertIn("- 工具：`shell_command`", md)
        self.assertIn("sk-***", md)
        self.assertIn("Bearer ***", md)
        self.assertNotIn("sk-1234567890abcdef", md)
        self.assertNotIn("abcdefghijklmnop", md)

    def test_format_tool_gate_md_synthetic_note(self) -> None:
        md = format_tool_gate_md(waiting=True, toolcall=None, synthetic=True)
        self.assertIn("注：这条状态来自启动时对 `codex-tui.log` 的尾部扫描", md)


if __name__ == "__main__":
    unittest.main()
