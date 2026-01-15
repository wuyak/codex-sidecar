import hashlib
import json
import threading
import sys
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional, Set

from .translator import Translator

from .watch.rollout_paths import _ROLLOUT_RE, _find_rollout_file_for_thread, _parse_thread_id_from_filename
from .watch.rollout_extract import extract_rollout_items
from .watch.translation_pump import TranslationPump
from .watch.follow_picker import FollowPicker
from .watch.tui_gate import TuiGateTailer

def _sha1_hex(s: str) -> str:
    return hashlib.sha1(s.encode("utf-8", errors="replace")).hexdigest()
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
        self._poll_interval_s = max(0.05, float(poll_interval_s))
        self._file_scan_interval_s = max(0.2, float(file_scan_interval_s))
        self._include_agent_reasoning = include_agent_reasoning
        self._follow_picker = FollowPicker(
            codex_home=self._codex_home,
            follow_codex_process=bool(follow_codex_process),
            codex_process_regex=str(codex_process_regex or "codex"),
            only_follow_when_process=bool(only_follow_when_process),
        )

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
        out: Dict[str, object] = {
            "current_file": str(self._current_file) if self._current_file is not None else "",
            "thread_id": self._thread_id or "",
            "offset": str(self._offset),
            "line_no": str(self._line_no),
            "last_error": self._last_error or "",
            "follow_mode": self._follow_mode or "",
            "selection_mode": sel,
            "pinned_thread_id": pin_tid,
            "pinned_file": pin_file,
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
        self._switch_to_latest_if_needed(force=True)
        if self._current_file is None and not self._warned_missing:
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
                self._switch_to_latest_if_needed(force=True)
                self._last_file_scan_ts = now
            if now - self._last_file_scan_ts >= self._file_scan_interval_s:
                self._switch_to_latest_if_needed(force=False)
                self._last_file_scan_ts = now
            self._poll_once()
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


    def _switch_to_latest_if_needed(self, force: bool) -> None:
        pick = self._follow_picker.pick(
            selection_mode=self._selection_mode,
            pinned_thread_id=self._pinned_thread_id,
            pinned_file=self._pinned_file,
        )
        picked = pick.picked
        self._process_file = pick.process_file
        self._codex_detected = bool(pick.codex_detected)
        self._codex_pids = list(pick.codex_pids or [])
        self._follow_mode = str(pick.follow_mode or "")
        if self._selection_mode == "pin" and picked is not None and self._pinned_file is None:
            self._pinned_file = picked
            tid = _parse_thread_id_from_filename(picked)
            if tid:
                self._pinned_thread_id = tid
        if picked is None:
            return
        if force or self._current_file is None or picked != self._current_file:
            self._current_file = picked
            self._thread_id = _parse_thread_id_from_filename(picked)
            self._offset = 0
            self._line_no = 0
            print(f"[sidecar] follow_file={picked}", file=sys.stderr)
            if self._replay_last_lines > 0:
                self._replay_tail(picked, self._replay_last_lines)
            else:
                # Seek to end (follow only new writes)
                try:
                    self._offset = picked.stat().st_size
                except Exception:
                    self._offset = 0


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

    def _replay_tail(self, path: Path, last_lines: int) -> None:
        # After replay, continue following from EOF.
        try:
            self._offset = path.stat().st_size
        except Exception:
            self._offset = 0

        # Respect the user's configured replay window strictly.
        replay_lines = max(0, int(last_lines))
        if replay_lines == 0:
            return

        tail = self._read_tail_lines(path, last_lines=replay_lines)
        for bline in tail:
            self._line_no += 1
            self._handle_line(bline, file_path=path, line_no=self._line_no, is_replay=True)

    def _poll_once(self) -> None:
        path = self._current_file
        if path is None:
            return
        try:
            with path.open("rb") as f:
                f.seek(self._offset)
                while True:
                    if self._stop_requested():
                        break
                    bline = f.readline()
                    if not bline:
                        break
                    self._offset = f.tell()
                    self._line_no += 1
                    self._handle_line(bline.rstrip(b"\n"), file_path=path, line_no=self._line_no, is_replay=False)
        except Exception:
            try:
                self._last_error = "poll_failed"
            except Exception:
                pass
            return

    def _handle_line(self, bline: bytes, file_path: Path, line_no: int, is_replay: bool) -> int:
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
                "thread_id": self._thread_id or "",
                "file": str(file_path),
                "line": line_no,
            }
            if self._ingest.ingest(msg):
                ingested += 1
                if is_thinking and text.strip():
                    # 翻译走后台支路：回放阶段可聚合，实时阶段按单条慢慢补齐。
                    thread_key = (self._thread_id or "") or str(file_path)
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
