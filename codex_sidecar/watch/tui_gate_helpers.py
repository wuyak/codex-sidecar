import json
import re
import time
from datetime import datetime, timezone
from typing import Dict, Optional, Tuple

_TS_HEAD_RE = re.compile(r"^(\d{4}-\d{2}-\d{2}T\S+)\s+(.*)$")


def split_ts(line: str) -> Tuple[str, str]:
    """
    拆分 codex-tui.log 的时间戳头。

    期望格式（去掉 ANSI 后）：
      2026-01-14T12:34:56.123Z  INFO waiting for tool gate
    """
    s = (line or "").lstrip()
    if not s:
        return ("", "")
    m = _TS_HEAD_RE.match(s)
    if not m:
        return ("", s)
    ts = (m.group(1) or "").strip()
    rest = (m.group(2) or "").strip()
    return (ts, rest)


def parse_toolcall(msg: str) -> Optional[Dict[str, object]]:
    # Example:
    #   INFO ToolCall: shell {"command":[...],"with_escalated_permissions":true,"justification":"..."}
    if "ToolCall:" not in msg:
        return None
    try:
        after = msg.split("ToolCall:", 1)[1].strip()
        if not after:
            return None
        tool, rest = (after.split(" ", 1) + [""])[:2]
        tool = tool.strip()
        rest = rest.strip()
        payload = None
        if rest.startswith("{") and rest.endswith("}"):
            try:
                payload = json.loads(rest)
            except Exception:
                payload = None
        return {"tool": tool, "payload": payload, "raw": rest}
    except Exception:
        return None


def ts_age_s(ts: str) -> Optional[float]:
    """
    Return age in seconds for a codex-tui.log timestamp like:
      2026-01-14T12:34:56.123Z
    """
    s = str(ts or "").strip()
    if not s:
        return None
    try:
        if s.endswith("Z"):
            s = s[:-1] + "+00:00"
        dt = datetime.fromisoformat(s)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return max(0.0, time.time() - dt.timestamp())
    except Exception:
        return None


def map_tool_name(tool: str) -> str:
    t = str(tool or "").strip()
    if t == "shell":
        return "shell_command"
    return t or "tool"


def redact_secrets(s: str) -> str:
    # Best-effort redaction for common token formats.
    out = str(s or "")
    out = re.sub(r"\b(sk-[A-Za-z0-9]{8,})\b", "sk-***", out)
    out = re.sub(r"\b(bearer)\s+[A-Za-z0-9._-]{12,}\b", r"\1 ***", out, flags=re.IGNORECASE)
    return out


def format_tool_gate_md(waiting: bool, toolcall: Optional[Dict[str, object]], *, synthetic: bool) -> str:
    icon = "⏸️" if waiting else "▶️"
    title = "终端等待确认（tool gate）" if waiting else "终端已确认（tool gate released）"
    lines = [f"{icon} {title}"]

    if synthetic:
        lines.append("")
        lines.append("注：这条状态来自启动时对 `codex-tui.log` 的尾部扫描；若你的终端没有确认提示，可能是历史残留，可忽略。")

    if toolcall:
        tool = map_tool_name(str(toolcall.get("tool") or ""))
        payload = toolcall.get("payload") if isinstance(toolcall.get("payload"), dict) else None
        if tool:
            lines.append("")
            lines.append(f"- 工具：`{tool}`")
        if payload and isinstance(payload, dict):
            just = payload.get("justification")
            if isinstance(just, str) and just.strip():
                lines.append(f"- 理由：{redact_secrets(just.strip())}")
            cmd = payload.get("command")
            cmd_s = ""
            if isinstance(cmd, list):
                try:
                    cmd_s = " ".join(str(x) for x in cmd if x is not None)
                except Exception:
                    cmd_s = ""
            elif isinstance(cmd, str):
                cmd_s = cmd
            if cmd_s.strip():
                cmd_s = redact_secrets(cmd_s.strip())
                lines.append("")
                lines.append("```")
                lines.append(cmd_s)
                lines.append("```")

    if waiting:
        lines.append("")
        lines.append("请回到终端完成确认/授权后，UI 才会继续刷新后续输出。")
        lines.append("（多会话场景下：tool gate 事件来自全局日志，可能并非当前会话。）")
    return "\n".join(lines).strip()
