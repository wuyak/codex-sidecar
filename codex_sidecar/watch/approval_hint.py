import json
import re
from typing import Any, Dict


_TOKEN_RE = re.compile(r"\b(sk-[A-Za-z0-9]{8,})\b")
_BEARER_RE = re.compile(r"\b(bearer)\s+[A-Za-z0-9._-]{12,}\b", re.IGNORECASE)


def _redact_secrets(s: str) -> str:
    out = str(s or "")
    out = _TOKEN_RE.sub("sk-***", out)
    out = _BEARER_RE.sub(r"\1 ***", out)
    return out


def _tool_call_needs_approval(text: str) -> bool:
    """
    Best-effort heuristic for Codex CLI approval prompts.

    注意：sandbox_permissions=require_escalated 并不一定意味着“真的会卡住等待用户确认”，
    这取决于 Codex 的 approval_policy（例如 never/auto/on-request）。
    这里仅用于“提示可能需要终端确认”，避免误报为确定的 tool gate 状态。
    """
    lines = [ln for ln in str(text or "").splitlines() if ln is not None]
    if not lines:
        return False
    # rollout_extract tool_call format:
    #   title\ncall_id=...\n{json args}
    # or
    #   title\n{json args}
    args_raw = ""
    if len(lines) >= 2 and lines[1].startswith("call_id="):
        args_raw = "\n".join(lines[2:]).strip()
    else:
        args_raw = "\n".join(lines[1:]).strip()
    if not (args_raw.startswith("{") and args_raw.endswith("}")):
        return False
    try:
        obj = json.loads(args_raw)
    except Exception:
        return False
    if not isinstance(obj, dict):
        return False
    sp = obj.get("sandbox_permissions")
    if isinstance(sp, str) and sp.strip() == "require_escalated":
        return True
    wep = obj.get("with_escalated_permissions")
    if wep is True:
        return True
    return False


def _format_approval_hint(tool_call_text: str) -> str:
    lines = [ln for ln in str(tool_call_text or "").splitlines() if ln is not None]
    title = (lines[0].strip() if lines else "") or "tool_call"
    args_raw = ""
    if len(lines) >= 2 and lines[1].startswith("call_id="):
        args_raw = "\n".join(lines[2:]).strip()
    else:
        args_raw = "\n".join(lines[1:]).strip()

    cmd = ""
    just = ""
    try:
        if args_raw.startswith("{") and args_raw.endswith("}"):
            obj: Any = json.loads(args_raw)
            if isinstance(obj, dict):
                c = obj.get("command")
                if isinstance(c, str):
                    cmd = c
                j = obj.get("justification")
                if isinstance(j, str):
                    just = j.strip()
    except Exception:
        pass

    head = "⚠️ 权限升级提示（可能需要终端确认）"
    parts = [head, "", f"- 工具：`{title}`"]
    if just:
        parts.append(f"- 原因（justification）：{_redact_secrets(just)}")
    if cmd.strip():
        parts.append("")
        parts.append("```")
        parts.append(_redact_secrets(cmd.strip()))
        parts.append("```")
    parts.append("")
    parts.append("注：该提示来自 tool_call 参数推断；是否需要批准以终端为准。若终端未出现确认提示，可忽略。")
    return "\n".join(parts).strip()

