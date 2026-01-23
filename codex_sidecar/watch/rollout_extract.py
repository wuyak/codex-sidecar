import json
from typing import Any, Dict, List, Tuple


def extract_rollout_items(obj: Dict[str, Any]) -> Tuple[str, List[Dict[str, str]]]:
    """
    从 rollout-*.jsonl 的单条记录中提取 UI 需要展示的消息块（可多条）。

    返回:
      - ts: 原始 timestamp（用于 UI 排序/去重 key）
      - extracted: [{kind, text}, ...]
    """
    if not isinstance(obj, dict):
        return ("", [])

    ts = obj.get("timestamp") or ""
    top_type = obj.get("type")
    payload = obj.get("payload") or {}
    if not isinstance(payload, dict):
        payload = {}

    extracted: List[Dict[str, str]] = []

    if top_type == "response_item":
        ptype = payload.get("type")

        # Assistant / User messages (final output and input echo)
        if ptype == "message":
            role = payload.get("role")
            # Prefer event_msg.user_message for user input (more concise).
            if role == "assistant":
                content = payload.get("content")
                parts: List[str] = []
                if isinstance(content, list):
                    for c in content:
                        if isinstance(c, dict) and isinstance(c.get("text"), str):
                            txt = c.get("text") or ""
                            if txt.strip():
                                parts.append(txt)
                if parts:
                    extracted.append({"kind": "assistant_message", "text": "\n".join(parts)})

        # Reasoning summary (final summary from response)
        if ptype == "reasoning":
            summary = payload.get("summary")
            if isinstance(summary, list):
                parts = []
                for item in summary:
                    if isinstance(item, dict) and item.get("type") == "summary_text":
                        txt = item.get("text")
                        if isinstance(txt, str) and txt.strip():
                            parts.append(txt)
                if parts:
                    extracted.append({"kind": "reasoning_summary", "text": "\n".join(parts)})

        # Tool calls / outputs (CLI tools, custom tools, web search)
        if ptype in ("function_call", "custom_tool_call", "web_search_call"):
            name = payload.get("name") if isinstance(payload.get("name"), str) else ""
            call_id = payload.get("call_id") if isinstance(payload.get("call_id"), str) else ""

            if ptype == "web_search_call":
                action = payload.get("action")
                text = json.dumps(action, ensure_ascii=False) if isinstance(action, (dict, list)) else str(action or "")
                title = "web_search_call"
            else:
                key = "arguments" if ptype == "function_call" else "input"
                raw = payload.get(key)
                text = str(raw or "")
                title = name or ptype

            prefix = f"call_id={call_id}\n" if call_id else ""
            extracted.append({"kind": "tool_call", "text": f"{title}\n{prefix}{text}".rstrip()})

        if ptype in ("function_call_output", "custom_tool_call_output"):
            call_id = payload.get("call_id") if isinstance(payload.get("call_id"), str) else ""
            out = payload.get("output")
            text = str(out or "")
            prefix = f"call_id={call_id}\n" if call_id else ""
            extracted.append({"kind": "tool_output", "text": f"{prefix}{text}".rstrip()})

    if top_type == "event_msg":
        ptype = payload.get("type")
        # User message echo in event stream (usually the most concise)
        if ptype == "user_message":
            msg = payload.get("message")
            if isinstance(msg, str) and msg.strip():
                extracted.append({"kind": "user_message", "text": msg})

    return (str(ts or ""), extracted)
