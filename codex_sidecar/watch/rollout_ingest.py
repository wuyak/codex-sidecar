import hashlib
import json
from pathlib import Path
from typing import Any, Callable, Dict, List, Tuple

from .approval_hint import _format_approval_hint, _tool_call_needs_approval
from .rollout_extract import extract_rollout_items


def sha1_hex(s: str) -> str:
    return hashlib.sha1(str(s or "").encode("utf-8", errors="replace")).hexdigest()


class RolloutLineIngestor:
    """
    将 rollout JSONL 的单行解析为 UI 消息并推送。

    目标：把“解析/去重/工具门禁提示/翻译入队”等逻辑从 watcher 主循环中拆出来，
    使 watcher 只负责“选文件 + tail + 调度”。
    """

    def __init__(
        self,
        *,
        stop_requested: Callable[[], bool],
        dedupe: Callable[[str, str], bool],
        emit_ingest: Callable[[Dict[str, Any]], bool],
        translate_enqueue: Callable[..., bool],
    ) -> None:
        self._stop_requested = stop_requested
        self._dedupe = dedupe
        self._emit_ingest = emit_ingest
        self._translate_enqueue = translate_enqueue

    def handle_line(
        self,
        bline: bytes,
        *,
        file_path: Path,
        line_no: int,
        is_replay: bool,
        thread_id: str,
        translate_mode: str,
    ) -> int:
        if self._stop_requested():
            return 0
        if not bline:
            return 0

        obj = None
        try:
            obj = json.loads(bline.decode("utf-8", errors="replace"))
        except Exception:
            obj = None
        if not isinstance(obj, dict):
            return 0

        ts, extracted = extract_rollout_items(obj)
        ingested = 0

        for item in extracted:
            if self._stop_requested():
                return ingested
            kind = str(item.get("kind", "") or "")
            text = str(item.get("text", "") or "")
            hid = sha1_hex(f"{file_path}:{kind}:{ts}:{text}")
            if self._dedupe(hid, kind=kind):
                continue

            mid = hid[:16]
            msg = {
                "id": mid,
                "ts": ts,
                "kind": kind,
                "text": text,
                "zh": "",
                "replay": bool(is_replay),
                "thread_id": str(thread_id or ""),
                "file": str(file_path),
                "line": int(line_no),
            }
            if self._emit_ingest(msg):
                ingested += 1

                # Proactively hint when a tool call likely requires terminal approval (Codex CLI on-request).
                if kind == "tool_call" and _tool_call_needs_approval(text):
                    self._emit_tool_gate_hint(ts=ts, hint_text=text, file_path=file_path, is_replay=is_replay, thread_id=thread_id, line_no=line_no)

                # 翻译走后台支路：
                # - auto：只自动翻译 reasoning_summary
                # - 回放阶段可聚合，实时阶段按单条慢慢补齐。
                if kind == "reasoning_summary" and translate_mode == "auto" and text.strip():
                    thread_key = str(thread_id or "") or str(file_path)
                    try:
                        self._translate_enqueue(mid=mid, text=text, thread_key=thread_key, batchable=bool(is_replay))
                    except Exception:
                        pass

        return ingested

    def _emit_tool_gate_hint(self, *, ts: str, hint_text: str, file_path: Path, is_replay: bool, thread_id: str, line_no: int) -> None:
        try:
            hint = _format_approval_hint(hint_text)
            hid2 = sha1_hex(f"{file_path}:approval_gate:{ts}:{hint}")
            if self._dedupe(hid2, kind="tool_gate"):
                return
            self._emit_ingest(
                {
                    "id": hid2[:16],
                    "ts": ts,
                    "kind": "tool_gate",
                    "text": hint,
                    "zh": "",
                    "replay": bool(is_replay),
                    "thread_id": str(thread_id or ""),
                    "file": str(file_path),
                    "line": int(line_no),
                }
            )
        except Exception:
            return

