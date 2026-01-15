import hashlib
import json
import re
import threading
import sys
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional, Set

from .translator import NoneTranslator, Translator

from .watch.rollout_paths import (
    _ROLLOUT_RE,
    _find_rollout_file_for_thread,
    _latest_rollout_files,
    _parse_thread_id_from_filename,
)
from .watch.rollout_extract import extract_rollout_items
from .watch.translation_pump import TranslationPump
from .watch.follow_picker import FollowPicker
from .watch.tui_gate import TuiGateTailer

def _sha1_hex(s: str) -> str:
    return hashlib.sha1(s.encode("utf-8", errors="replace")).hexdigest()

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
            obj = json.loads(args_raw)
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


@dataclass
class _FileCursor:
    path: Path
    thread_id: str
    offset: int = 0
    line_no: int = 0
    active: bool = False
    last_active_ts: float = 0.0
    inited: bool = False


@dataclass
class HttpIngestClient:
    server_url: str
    timeout_s: float = 2.0

    def ingest(self, msg: dict) -> bool:
        url = self.server_url.rstrip("/") + "/ingest"
        data = json.dumps(msg, ensure_ascii=False).encode("utf-8")
        req = urllib.request.Request(url, data=data, method="POST")
        req.add_header("Content-Type", "application/json; charset=utf-8")
        try:
            with urllib.request.urlopen(req, timeout=self.timeout_s) as resp:
                return 200 <= resp.status < 300
        except (urllib.error.URLError, urllib.error.HTTPError):
            return False


class RolloutWatcher:
    def __init__(
        self,
        codex_home: Path,
        ingest: HttpIngestClient,
        translator: Translator,
        replay_last_lines: int,
        watch_max_sessions: int,
        translate_mode: str,
        poll_interval_s: float,
        file_scan_interval_s: float,
        include_agent_reasoning: bool,
        follow_codex_process: bool = False,
        codex_process_regex: str = "codex",
        only_follow_when_process: bool = True,
    ) -> None:
        self._codex_home = codex_home
        self._ingest = ingest
        self._translator = translator
        self._replay_last_lines = max(0, int(replay_last_lines))
        self._watch_max_sessions = max(1, int(watch_max_sessions or 3))
        tm = str(translate_mode or "auto").strip().lower()
        self._translate_mode = tm if tm in ("auto", "manual") else "auto"
        self._poll_interval_s = max(0.05, float(poll_interval_s))
        self._file_scan_interval_s = max(0.2, float(file_scan_interval_s))
        self._include_agent_reasoning = include_agent_reasoning
        self._follow_picker = FollowPicker(
            codex_home=self._codex_home,
            follow_codex_process=bool(follow_codex_process),
            codex_process_regex=str(codex_process_regex or "codex"),
            only_follow_when_process=bool(only_follow_when_process),
        )

        # Follow targets (multi-session).
        self._cursors: Dict[Path, _FileCursor] = {}
        self._follow_files: List[Path] = []

        self._current_file: Optional[Path] = None
        self._offset: int = 0
        self._line_no: int = 0
        self._thread_id: Optional[str] = None

        self._seen: Set[str] = set()
        self._seen_max = 5000
        self._last_file_scan_ts = 0.0
        self._warned_missing = False
        self._last_error: str = ""
        self._follow_mode: str = "legacy"  # legacy|process|fallback|idle
        self._codex_detected: bool = False
        self._codex_pids: List[int] = []
        self._process_file: Optional[Path] = None

        # Follow strategy:
        # - auto: pick follow file via existing logic (latest / process-based)
        # - pin:  lock to a specific thread/file (user-selected in UI)
        self._follow_lock = threading.Lock()
        self._selection_mode: str = "auto"  # auto|pin
        self._pinned_thread_id: str = ""
        self._pinned_file: Optional[Path] = None
        self._follow_dirty: bool = False

        # Codex TUI log tail: surface "waiting for tool gate" so UI can show
        # "needs confirmation" states even when no new rollout lines appear.
        self._tui = TuiGateTailer(self._codex_home / "log" / "codex-tui.log")
        self._stop_event: Optional[threading.Event] = None

        # Translation is decoupled from ingestion: watcher ingests EN first,
        # then a background worker translates and patches via op=update.
        self._translate = TranslationPump(
            translator=self._translator,
            emit_update=self._ingest.ingest,
            batch_size=5,
        )

    def retranslate(self, mid: str, text: str, thread_key: str) -> bool:
        """
        Force (re)translation for a single message id.
        Called from the HTTP control plane when user clicks "重译" in the UI.
        """
        if self._stop_requested():
            return False
        try:
            if self._translate is None:
                return False
            self._translate.enqueue(
                mid=str(mid or "").strip(),
                text=str(text or ""),
                thread_key=str(thread_key or ""),
                batchable=False,
                force=True,
            )
            return True
        except Exception:
            return False

    def _stop_requested(self) -> bool:
        ev = self._stop_event
        if ev is None:
            return False
        try:
            return ev.is_set()
        except Exception:
            return False

    def status(self) -> Dict[str, object]:
        sel = "auto"
        pin_tid = ""
        pin_file = ""
        try:
            with self._follow_lock:
                sel = self._selection_mode or "auto"
                pin_tid = self._pinned_thread_id or ""
                pin_file = str(self._pinned_file) if self._pinned_file is not None else ""
        except Exception:
            sel = "auto"
        primary_offset = self._offset
        primary_line_no = self._line_no
        try:
            if self._current_file is not None:
                cur = self._cursors.get(self._current_file)
                if cur is not None:
                    primary_offset = int(cur.offset)
                    primary_line_no = int(cur.line_no)
        except Exception:
            primary_offset = self._offset
            primary_line_no = self._line_no
        out: Dict[str, object] = {
            "current_file": str(self._current_file) if self._current_file is not None else "",
            "thread_id": self._thread_id or "",
            "offset": str(primary_offset),
            "line_no": str(primary_line_no),
            "last_error": self._last_error or "",
            "follow_mode": self._follow_mode or "",
            "selection_mode": sel,
            "pinned_thread_id": pin_tid,
            "pinned_file": pin_file,
            "watch_max_sessions": str(self._watch_max_sessions),
            "follow_files": [str(p) for p in (self._follow_files or [])][:12],
            "codex_detected": "1" if self._codex_detected else "0",
            "codex_pids": ",".join(str(x) for x in self._codex_pids[:8]),
            "codex_process_regex": self._follow_picker.codex_process_regex,
            "process_file": str(self._process_file) if self._process_file is not None else "",
        }
        try:
            if self._translate is not None:
                out["translate"] = self._translate.stats()
        except Exception:
            pass
        return out

    def set_follow(self, mode: str, thread_id: str = "", file: str = "") -> None:
        """
        Update follow strategy at runtime (called from HTTP control plane).

        - mode=auto: use existing selection strategy (latest/process)
        - mode=pin : lock to a specific thread_id or file path
        """
        m = str(mode or "").strip().lower()
        if m not in ("auto", "pin"):
            m = "auto"
        tid = str(thread_id or "").strip()
        fp = str(file or "").strip()

        pinned_file: Optional[Path] = None
        if fp:
            try:
                cand = Path(fp).expanduser()
                if not cand.is_absolute():
                    cand = (self._codex_home / cand).resolve()
                else:
                    cand = cand.resolve()
                sessions_root = (self._codex_home / "sessions").resolve()
                try:
                    _ = cand.relative_to(sessions_root)
                except Exception:
                    cand = None  # type: ignore[assignment]
                if cand is not None and cand.exists() and cand.is_file() and _ROLLOUT_RE.match(cand.name):
                    pinned_file = cand
            except Exception:
                pinned_file = None

        if pinned_file is None and tid:
            pinned_file = _find_rollout_file_for_thread(self._codex_home, tid)

        with self._follow_lock:
            self._selection_mode = m
            if m == "pin":
                self._pinned_thread_id = tid
                self._pinned_file = pinned_file
            else:
                self._pinned_thread_id = ""
                self._pinned_file = None
            self._follow_dirty = True

    def run(self, stop_event) -> None:
        # Keep a reference so inner loops can react quickly (e.g. stop in the middle of large file reads).
        self._stop_event = stop_event
        self._translate.start(stop_event)
        # Initial pick
        self._sync_follow_targets(force=True)
        if not self._follow_files and not self._warned_missing:
            if self._follow_mode == "idle":
                print("[sidecar] 等待 Codex 进程（尚未开始跟随会话文件）", file=sys.stderr)
            else:
                print(
                    f"[sidecar] 未找到会话文件：{self._codex_home}/sessions/**/rollout-*.jsonl",
                    file=sys.stderr,
                )
            self._warned_missing = True
        while not stop_event.is_set():
            now = time.time()
            # Follow mode changed (e.g. UI pinned a thread): force a rescan/switch immediately.
            force_switch = False
            try:
                with self._follow_lock:
                    if self._follow_dirty:
                        self._follow_dirty = False
                        force_switch = True
            except Exception:
                force_switch = False
            if force_switch:
                self._sync_follow_targets(force=True)
                self._last_file_scan_ts = now
            if now - self._last_file_scan_ts >= self._file_scan_interval_s:
                self._sync_follow_targets(force=False)
                self._last_file_scan_ts = now
            self._poll_follow_files()
            try:
                self._tui.poll(
                    thread_id=self._thread_id or "",
                    read_tail_lines=self._read_tail_lines,
                    sha1_hex=_sha1_hex,
                    dedupe=self._dedupe,
                    ingest=self._ingest.ingest,
                )
            except Exception:
                pass
            stop_event.wait(self._poll_interval_s)


    def _sync_follow_targets(self, force: bool) -> None:
        """
        Keep a stable set of followed session files.

        - auto: follow primary picked by FollowPicker + fill to N latest session files.
        - pin : primary pinned file, but still keep monitoring other latest sessions up to N
                (so new threads appear without requiring a manual "全部" refresh).
        """
        try:
            with self._follow_lock:
                sel = str(self._selection_mode or "auto").strip().lower()
                pin_tid = str(self._pinned_thread_id or "").strip()
                pin_file = self._pinned_file
        except Exception:
            sel = "auto"
            pin_tid = ""
            pin_file = None

        pick = self._follow_picker.pick(selection_mode=sel, pinned_thread_id=pin_tid, pinned_file=pin_file)
        picked = pick.picked
        self._process_file = pick.process_file
        self._codex_detected = bool(pick.codex_detected)
        self._codex_pids = list(pick.codex_pids or [])
        self._follow_mode = str(pick.follow_mode or "")

        # If UI pins by thread id only, resolve to a concrete file path for later.
        if sel == "pin" and picked is not None:
            try:
                with self._follow_lock:
                    if self._pinned_file is None:
                        self._pinned_file = picked
                    if not self._pinned_thread_id:
                        tid = _parse_thread_id_from_filename(picked)
                        if tid:
                            self._pinned_thread_id = tid
            except Exception:
                pass

        # When we are explicitly in "idle / wait_codex" mode, do not follow any file.
        if picked is None and self._follow_mode in ("idle", "wait_codex"):
            if force or self._follow_files:
                self._follow_files = []
                self._current_file = None
                self._thread_id = None
                self._offset = 0
                self._line_no = 0
                for cur in self._cursors.values():
                    cur.active = False
            return

        targets: List[Path] = []
        if picked is not None:
            targets.append(picked)

        n = max(1, int(self._watch_max_sessions or 1))
        if len(targets) < n:
            try:
                cands = _latest_rollout_files(self._codex_home, limit=max(n * 3, n))
            except Exception:
                cands = []
            for p in cands:
                if len(targets) >= n:
                    break
                if p in targets:
                    continue
                targets.append(p)

        changed = force or (targets != self._follow_files)
        if not changed:
            return

        self._follow_files = targets

        keep = set(targets)
        now = time.time()
        for p, cur in list(self._cursors.items()):
            cur.active = p in keep
            if cur.active:
                cur.last_active_ts = now

        for p in targets:
            cur = self._cursors.get(p)
            if cur is None:
                tid = _parse_thread_id_from_filename(p) or ""
                cur = _FileCursor(path=p, thread_id=tid)
                self._cursors[p] = cur
            cur.active = True
            cur.last_active_ts = now
            if not cur.inited:
                cur.inited = True
                # Seek to end (follow only new writes), optionally replay last N lines.
                try:
                    cur.offset = int(p.stat().st_size)
                except Exception:
                    cur.offset = 0
                if self._replay_last_lines > 0:
                    self._replay_tail(cur, self._replay_last_lines)

        # Update "primary" fields for status and tool gate tagging.
        self._current_file = targets[0] if targets else None
        self._thread_id = _parse_thread_id_from_filename(targets[0]) if targets else None
        if self._current_file is not None:
            try:
                cur = self._cursors.get(self._current_file)
                if cur is not None:
                    self._offset = int(cur.offset)
                    self._line_no = int(cur.line_no)
            except Exception:
                pass

        try:
            if targets:
                joined = " | ".join(str(p) for p in targets[:6])
                print(f"[sidecar] follow_files={len(targets)} primary={targets[0]} | {joined}", file=sys.stderr)
        except Exception:
            pass


    def _read_tail_lines(self, path: Path, last_lines: int, max_bytes: int = 32 * 1024 * 1024) -> List[bytes]:
        """
        从文件尾部向前读取，尽量精确获取最后 N 行，避免单纯固定字节数导致“回放不足”。

        - last_lines: 需要的行数（不含可能的前置 partial line）
        - max_bytes: 最多读取的字节数上限，防止极端大文件占用过高
        """
        try:
            size = path.stat().st_size
        except Exception:
            return []

        if size == 0:
            return []

        block = 256 * 1024
        want = max(1, last_lines + 1)
        buf = b""
        read_bytes = 0
        pos = size

        while pos > 0 and buf.count(b"\n") < want and read_bytes < max_bytes:
            step = block if pos >= block else pos
            pos -= step
            try:
                with path.open("rb") as f:
                    f.seek(pos)
                    chunk = f.read(step)
            except Exception:
                break
            buf = chunk + buf
            read_bytes += len(chunk)

        lines = buf.splitlines()
        # If we didn't start from 0, we may have a partial first line; drop it.
        if pos != 0 and lines:
            lines = lines[1:]
        return lines[-last_lines:] if last_lines > 0 else lines

    def _replay_tail(self, cur: _FileCursor, last_lines: int) -> None:
        path = cur.path
        # Respect the user's configured replay window strictly.
        replay_lines = max(0, int(last_lines))
        if replay_lines == 0:
            return
        tail = self._read_tail_lines(path, last_lines=replay_lines)
        for bline in tail:
            if self._stop_requested():
                break
            cur.line_no += 1
            self._handle_line(
                bline,
                file_path=path,
                line_no=cur.line_no,
                is_replay=True,
                thread_id=cur.thread_id,
            )

    def _poll_follow_files(self) -> None:
        for path in list(self._follow_files):
            if self._stop_requested():
                break
            cur = self._cursors.get(path)
            if cur is None or not cur.active:
                continue
            self._poll_one(cur)

    def _poll_one(self, cur: _FileCursor) -> None:
        path = cur.path
        try:
            size = int(path.stat().st_size)
        except Exception:
            return
        if cur.offset > size:
            cur.offset = 0
        try:
            with path.open("rb") as f:
                f.seek(cur.offset)
                while True:
                    if self._stop_requested():
                        break
                    bline = f.readline()
                    if not bline:
                        break
                    cur.offset = int(f.tell())
                    cur.line_no += 1
                    if self._current_file == path:
                        self._offset = cur.offset
                        self._line_no = cur.line_no
                    self._handle_line(
                        bline.rstrip(b"\n"),
                        file_path=path,
                        line_no=cur.line_no,
                        is_replay=False,
                        thread_id=cur.thread_id,
                    )
        except Exception:
            try:
                self._last_error = "poll_failed"
            except Exception:
                pass
            return

    def _handle_line(self, bline: bytes, file_path: Path, line_no: int, is_replay: bool, *, thread_id: str) -> int:
        # If user clicked “停止监听”, avoid ingesting more lines even if we're still finishing in-flight work.
        if self._stop_requested():
            return 0
        if not bline:
            return 0
        try:
            obj = json.loads(bline.decode("utf-8", errors="replace"))
        except Exception:
            return 0

        ts, extracted = extract_rollout_items(obj, include_agent_reasoning=self._include_agent_reasoning)

        ingested = 0
        for item in extracted:
            kind = item["kind"]
            text = item["text"]
            # Dedup across replay expansions.
            #
            # - reasoning_summary: 通常每条是“最终摘要”，用 timestamp 参与 key 能更好地区分不同轮次
            # - agent_reasoning: 往往是流式/重复广播（同一段 text 可能出现多次），避免把 ts 纳入 key
            #   以减少 UI 里“同一段内容重复两次”的噪音
            if kind == "agent_reasoning":
                hid = _sha1_hex(f"{file_path}:{kind}:{text}")
            else:
                hid = _sha1_hex(f"{file_path}:{kind}:{ts}:{text}")
            if self._dedupe(hid, kind=kind):
                continue
            if self._stop_requested():
                return ingested
            mid = hid[:16]
            is_thinking = kind in ("reasoning_summary", "agent_reasoning")
            msg = {
                "id": mid,
                "ts": ts,
                "kind": kind,
                "text": text,
                "zh": "",
                "thread_id": str(thread_id or ""),
                "file": str(file_path),
                "line": line_no,
            }
            if self._ingest.ingest(msg):
                ingested += 1
                # Proactively hint when a tool call likely requires terminal approval (Codex CLI on-request).
                if kind == "tool_call" and _tool_call_needs_approval(text):
                    try:
                        hint = _format_approval_hint(text)
                        hid2 = _sha1_hex(f"{file_path}:approval_gate:{ts}:{hint}")
                        if not self._dedupe(hid2, kind="tool_gate"):
                            self._ingest.ingest(
                                {
                                    "id": hid2[:16],
                                    "ts": ts,
                                    "kind": "tool_gate",
                                    "text": hint,
                                    "zh": "",
                                    "thread_id": str(thread_id or ""),
                                    "file": str(file_path),
                                    "line": line_no,
                                }
                            )
                    except Exception:
                        pass
                if is_thinking and text.strip():
                    # 翻译走后台支路：回放阶段可聚合，实时阶段按单条慢慢补齐。
                    if self._translate_mode == "auto" and not isinstance(self._translator, NoneTranslator):
                        thread_key = str(thread_id or "") or str(file_path)
                        self._translate.enqueue(mid=mid, text=text, thread_key=thread_key, batchable=is_replay)
        return ingested


    def _dedupe(self, key: str, kind: str) -> bool:
        if key in self._seen:
            return True
        self._seen.add(key)
        if len(self._seen) > self._seen_max:
            # Cheap pruning: approximate by clearing periodically.
            # (OK for a sidecar; duplicates are benign and bounded.)
            self._seen.clear()
            # Keep a marker so we don't immediately re-add duplicates in the same run loop.
            self._seen.add(key)
        return False
