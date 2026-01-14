import hashlib
import json
import os
import queue
import re
import threading
import sys
import time
import urllib.error
import urllib.request
from collections import deque
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Deque, Dict, Iterable, List, Optional, Pattern, Set, Tuple

from .translator import NoneTranslator, Translator


_ROLLOUT_RE = re.compile(
    r"^rollout-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-([0-9a-fA-F-]{36})\.jsonl$"
)
_PROC_ROOT = Path("/proc")
_ANSI_RE = re.compile(r"\x1b\[[0-9;]*m")

_TRANSLATE_BATCH_MAGIC = "<<<SIDECAR_TRANSLATE_BATCH_V1>>>"
_TRANSLATE_BATCH_ITEM_RE = re.compile(r"^<<<SIDECAR_ITEM:([^>]+)>>>\\s*$")
_TRANSLATE_BATCH_END = "<<<SIDECAR_END>>>"


def _pack_translate_batch(items: List[Tuple[str, str]]) -> str:
    """
    Pack multiple items into a single translation request.

    Format contract:
    - Markers must remain verbatim (do NOT translate them).
    - Translator should output the same markers and translated content between them.
    """
    lines = [
        "请将下列内容翻译为中文。",
        "要求：逐行原样保留所有形如 <<<SIDECAR_...>>> 的标记行（不要翻译、不要改动、不要增删）。",
        "输出必须包含最后一行 <<<SIDECAR_END>>>。",
        "",
        _TRANSLATE_BATCH_MAGIC,
    ]
    for mid, text in items:
        lines.append(f"<<<SIDECAR_ITEM:{mid}>>>")
        lines.append(str(text or "").rstrip())
    lines.append(_TRANSLATE_BATCH_END)
    return "\n".join(lines).rstrip() + "\n"


def _unpack_translate_batch(output: str, wanted_ids: Set[str]) -> Dict[str, str]:
    """Extract per-item translations from a packed response."""
    out: Dict[str, str] = {}
    cur_id: Optional[str] = None
    buf: List[str] = []

    def _flush() -> None:
        nonlocal cur_id, buf
        if cur_id and cur_id in wanted_ids:
            out[cur_id] = "\n".join(buf).strip()
        cur_id = None
        buf = []

    for raw in str(output or "").splitlines():
        line = raw.strip()
        if not line:
            if cur_id is not None:
                buf.append("")
            continue
        if line == _TRANSLATE_BATCH_MAGIC:
            continue
        if line == _TRANSLATE_BATCH_END:
            _flush()
            break
        m = _TRANSLATE_BATCH_ITEM_RE.match(line)
        if m:
            _flush()
            cur_id = m.group(1).strip()
            buf = []
            continue
        if cur_id is not None:
            buf.append(raw)
    _flush()
    return out


def _latest_rollout_file(codex_home: Path) -> Optional[Path]:
    sessions = codex_home / "sessions"
    if not sessions.exists():
        return None
    # Layout: sessions/YYYY/MM/DD/rollout-*.jsonl
    globbed = list(sessions.glob("*/*/*/rollout-*.jsonl"))
    if not globbed:
        return None
    globbed.sort(key=lambda p: p.stat().st_mtime, reverse=True)
    return globbed[0]


def _parse_thread_id_from_filename(path: Path) -> Optional[str]:
    m = _ROLLOUT_RE.match(path.name)
    if not m:
        return None
    return m.group(1)


def _find_rollout_file_for_thread(codex_home: Path, thread_id: str) -> Optional[Path]:
    """
    Locate rollout file by thread_id (uuid) inside CODEX_HOME/sessions.
    """
    tid = str(thread_id or "").strip()
    if not tid:
        return None
    sessions = codex_home / "sessions"
    if not sessions.exists():
        return None
    # Layout: sessions/YYYY/MM/DD/rollout-...-{thread_id}.jsonl
    try:
        hits = list(sessions.glob(f"*/*/*/rollout-*-{tid}.jsonl"))
    except Exception:
        hits = []
    if not hits:
        return None
    try:
        hits.sort(key=lambda p: p.stat().st_mtime, reverse=True)
    except Exception:
        pass
    return hits[0]


def _sha1_hex(s: str) -> str:
    return hashlib.sha1(s.encode("utf-8", errors="replace")).hexdigest()


def _proc_list_pids() -> List[int]:
    try:
        names = os.listdir(str(_PROC_ROOT))
    except Exception:
        return []
    out: List[int] = []
    for n in names:
        if not n.isdigit():
            continue
        try:
            out.append(int(n))
        except Exception:
            continue
    return out


def _proc_read_cmdline(pid: int, max_bytes: int = 64 * 1024) -> str:
    try:
        raw = (_PROC_ROOT / str(pid) / "cmdline").read_bytes()
    except Exception:
        return ""
    if not raw:
        return ""
    if len(raw) > max_bytes:
        raw = raw[:max_bytes]
    parts = [p for p in raw.split(b"\x00") if p]
    try:
        return " ".join(p.decode("utf-8", errors="replace") for p in parts)
    except Exception:
        return ""


def _proc_read_ppid(pid: int) -> Optional[int]:
    try:
        txt = (_PROC_ROOT / str(pid) / "status").read_text(encoding="utf-8", errors="replace")
    except Exception:
        return None
    for line in txt.splitlines():
        if line.startswith("PPid:"):
            v = (line.split(":", 1)[1] or "").strip()
            try:
                return int(v)
            except Exception:
                return None
    return None


def _proc_iter_fd_targets(pid: int) -> Iterable[str]:
    fd_dir = _PROC_ROOT / str(pid) / "fd"
    try:
        entries = os.listdir(str(fd_dir))
    except Exception:
        return []
    out: List[str] = []
    for ent in entries:
        p = fd_dir / ent
        try:
            target = os.readlink(str(p))
        except Exception:
            continue
        if target.endswith(" (deleted)"):
            target = target[: -len(" (deleted)")]
        out.append(target)
    return out


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
        self._follow_codex_process = bool(follow_codex_process)
        self._only_follow_when_process = bool(only_follow_when_process)
        self._codex_process_regex_raw = str(codex_process_regex or "codex")
        self._codex_process_re: Optional[Pattern[str]] = None
        try:
            self._codex_process_re = re.compile(self._codex_process_regex_raw, flags=re.IGNORECASE)
        except Exception:
            self._codex_process_re = None

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
        self._tui_log_path = (self._codex_home / "log" / "codex-tui.log")
        self._tui_inited = False
        self._tui_offset = 0
        self._tui_buf = b""
        self._tui_last_toolcall: Optional[Dict[str, object]] = None
        self._tui_gate_waiting: bool = False
        self._stop_event: Optional[threading.Event] = None

        # Translation is decoupled from ingestion: watcher ingests EN first,
        # then a background worker translates and patches via op=update.
        self._translate_q: "queue.Queue[Dict[str, Any]]" = queue.Queue(maxsize=1000)
        self._translate_pending: Deque[Dict[str, Any]] = deque()
        self._translate_thread: Optional[threading.Thread] = None
        self._translate_batch_size = 5

    def _stop_requested(self) -> bool:
        ev = self._stop_event
        if ev is None:
            return False
        try:
            return ev.is_set()
        except Exception:
            return False

    def status(self) -> Dict[str, str]:
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
        return {
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
            "codex_process_regex": self._codex_process_regex_raw,
            "process_file": str(self._process_file) if self._process_file is not None else "",
        }

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
        self._start_translation_worker(stop_event)
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
            self._poll_tui_log()
            stop_event.wait(self._poll_interval_s)

    def _start_translation_worker(self, stop_event) -> None:
        if self._translate_thread is not None and self._translate_thread.is_alive():
            return
        if isinstance(self._translator, NoneTranslator):
            return
        try:
            t = threading.Thread(
                target=self._translate_worker,
                args=(stop_event,),
                name="sidecar-translate",
                daemon=True,
            )
            self._translate_thread = t
            t.start()
        except Exception:
            self._translate_thread = None

    def _enqueue_translation(self, mid: str, text: str, thread_key: str, batchable: bool) -> None:
        if isinstance(self._translator, NoneTranslator):
            return
        m = str(mid or "").strip()
        if not m:
            return
        t = str(text or "")
        if not t.strip():
            return
        item: Dict[str, Any] = {
            "id": m,
            "text": t,
            "key": str(thread_key or ""),
            "batchable": bool(batchable),
        }
        try:
            self._translate_q.put_nowait(item)
        except queue.Full:
            # Backpressure: drop oldest to keep UI responsive.
            try:
                _ = self._translate_q.get_nowait()
            except queue.Empty:
                return
            try:
                self._translate_q.put_nowait(item)
            except queue.Full:
                return

    def _normalize_translation(self, src: str, zh: str) -> str:
        s = str(src or "")
        z = str(zh or "")
        if s.strip() and (not z.strip()) and not isinstance(self._translator, NoneTranslator):
            err = str(getattr(self._translator, "last_error", "") or "").strip()
            hint = err if err else "WARN: 翻译失败（返回空译文）"
            return f"⚠️ {hint}\n\n{s}"
        return z

    def _translate_worker(self, stop_event) -> None:
        pending = self._translate_pending
        while not stop_event.is_set():
            try:
                if pending:
                    item = pending.popleft()
                else:
                    item = self._translate_q.get(timeout=0.2)
            except queue.Empty:
                continue
            except Exception:
                continue

            try:
                mid = str(item.get("id") or "").strip()
                text = str(item.get("text") or "")
                key = str(item.get("key") or "")
                batchable = bool(item.get("batchable"))
            except Exception:
                continue
            if not mid or not text.strip():
                continue

            batch: List[Dict[str, Any]] = [item]
            if batchable and key:
                while len(batch) < int(self._translate_batch_size or 5):
                    try:
                        nxt = self._translate_q.get_nowait()
                    except queue.Empty:
                        break
                    except Exception:
                        break
                    try:
                        if bool(nxt.get("batchable")) and str(nxt.get("key") or "") == key:
                            batch.append(nxt)
                        else:
                            pending.append(nxt)
                    except Exception:
                        pending.append(nxt)

            # Translate.
            try:
                if len(batch) == 1:
                    zh = self._normalize_translation(text, self._translator.translate(text))
                    if stop_event.is_set():
                        continue
                    self._ingest.ingest({"op": "update", "id": mid, "zh": zh})
                    continue

                pairs: List[Tuple[str, str]] = []
                wanted: Set[str] = set()
                for it in batch:
                    iid = str(it.get("id") or "").strip()
                    itxt = str(it.get("text") or "")
                    if not iid or not itxt.strip():
                        continue
                    pairs.append((iid, itxt))
                    wanted.add(iid)
                if len(pairs) <= 1:
                    zh = self._normalize_translation(text, self._translator.translate(text))
                    if stop_event.is_set():
                        continue
                    self._ingest.ingest({"op": "update", "id": mid, "zh": zh})
                    continue

                packed = _pack_translate_batch(pairs)
                out = self._translator.translate(packed)
                mapping = _unpack_translate_batch(out, wanted_ids=wanted)

                for iid, itxt in pairs:
                    if stop_event.is_set():
                        break
                    zh = mapping.get(iid)
                    if zh is None:
                        zh = self._translator.translate(itxt)
                    zh = self._normalize_translation(itxt, zh)
                    self._ingest.ingest({"op": "update", "id": iid, "zh": zh})
            except Exception:
                continue

    def _switch_to_latest_if_needed(self, force: bool) -> None:
        picked = self._pick_follow_file()
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

    def _pick_follow_file(self) -> Optional[Path]:
        """
        选择要跟随的 rollout 文件。

        在启用 follow_codex_process 时，优先级为：
        1) 进程 FD 定位（更精准：正在写入的会话文件）
        2) sessions 扫描最新文件（回退：用于“进程已启动但文件尚未打开/被发现”的窗口期）
        3) 空闲（仅在 only_follow_when_process=true 且未检测到 Codex 时）
        """
        self._process_file = None
        self._codex_detected = False
        self._codex_pids = []

        # UI pin: lock to a specific thread/file (preferred over auto selection).
        sel = "auto"
        pin_tid = ""
        pin_file = None
        try:
            with self._follow_lock:
                sel = self._selection_mode or "auto"
                pin_tid = self._pinned_thread_id or ""
                pin_file = self._pinned_file
        except Exception:
            sel = "auto"
            pin_tid = ""
            pin_file = None

        if sel == "pin":
            picked = pin_file
            if picked is None and pin_tid:
                picked = _find_rollout_file_for_thread(self._codex_home, pin_tid)
                if picked is not None:
                    try:
                        with self._follow_lock:
                            self._pinned_file = picked
                    except Exception:
                        pass
            if picked is not None:
                self._follow_mode = "pinned"
                self._last_error = ""
                return picked
            # Keep auto as a fallback, but surface status.
            self._follow_mode = "pinned_missing"
            self._last_error = "pinned_missing"

        if not self._follow_codex_process:
            self._follow_mode = "legacy"
            if self._last_error != "pinned_missing":
                self._last_error = ""
            return _latest_rollout_file(self._codex_home)

        detected, root_pids = self._detect_codex_processes()
        self._codex_detected = detected
        self._codex_pids = root_pids

        if not detected:
            self._follow_mode = "idle" if self._only_follow_when_process else "fallback"
            if self._only_follow_when_process:
                self._last_error = "wait_codex"
                return None
            self._last_error = ""
            return _latest_rollout_file(self._codex_home)

        # Codex 已检测到：优先从进程打开的 FD 中找当前会话文件。
        tree = self._collect_process_tree(root_pids)
        proc_file = self._find_rollout_opened_by_pids(tree)
        if proc_file is not None:
            self._follow_mode = "process"
            self._process_file = proc_file
            self._last_error = ""
            return proc_file

        # 进程存在但暂未定位到文件：回退到 sessions 最新文件（等待窗口期）。
        latest = _latest_rollout_file(self._codex_home)
        if latest is None:
            self._follow_mode = "fallback"
            self._last_error = "wait_rollout"
            return None
        self._follow_mode = "fallback"
        self._last_error = ""
        return latest

    def _detect_codex_processes(self) -> Tuple[bool, List[int]]:
        if self._codex_process_re is None:
            return False, []
        me = os.getpid()
        hits: List[int] = []
        for pid in _proc_list_pids():
            if pid == me:
                continue
            cmd = _proc_read_cmdline(pid)
            if not cmd:
                continue
            try:
                if self._codex_process_re.search(cmd):
                    hits.append(pid)
            except Exception:
                continue
        hits.sort()
        return (len(hits) > 0), hits

    def _collect_process_tree(self, root_pids: List[int], max_pids: int = 512) -> List[int]:
        """
        从 root_pids 扩展子进程，形成进程树集合（用于覆盖“写入发生在子进程”的情况）。
        """
        roots = [p for p in root_pids if p > 0]
        if not roots:
            return []

        # 每隔 file_scan_interval 扫描一次，成本可控。
        all_pids = _proc_list_pids()
        children: Dict[int, List[int]] = {}
        for pid in all_pids:
            ppid = _proc_read_ppid(pid)
            if ppid is None:
                continue
            children.setdefault(ppid, []).append(pid)

        out: List[int] = []
        seen: Set[int] = set()
        q: List[int] = list(roots)
        while q and len(out) < max_pids:
            pid = q.pop(0)
            if pid in seen:
                continue
            seen.add(pid)
            out.append(pid)
            for c in children.get(pid, []):
                if c not in seen:
                    q.append(c)
        return out

    def _find_rollout_opened_by_pids(self, pids: List[int]) -> Optional[Path]:
        sessions_root = (self._codex_home / "sessions").resolve()
        candidates: List[Path] = []
        for pid in pids:
            for target in _proc_iter_fd_targets(pid):
                if "rollout-" not in target or not target.endswith(".jsonl"):
                    continue
                try:
                    p = Path(target)
                except Exception:
                    continue
                # 限定为当前 watch_codex_home 下的 sessions 文件，避免误命中其它 jsonl。
                try:
                    _ = p.resolve().relative_to(sessions_root)
                except Exception:
                    continue
                if not _ROLLOUT_RE.match(p.name):
                    continue
                try:
                    if not p.exists():
                        continue
                except Exception:
                    continue
                candidates.append(p)

        if not candidates:
            return None

        # 若当前已跟随文件仍在候选中，优先保持，避免在多个 FD 之间抖动切换。
        if self._current_file is not None:
            try:
                cur = self._current_file.resolve()
                for c in candidates:
                    if c.resolve() == cur:
                        return c
            except Exception:
                pass

        best: Optional[Path] = None
        best_mtime: float = -1.0
        for c in candidates:
            try:
                st = c.stat()
                mtime = float(st.st_mtime)
            except Exception:
                continue
            if mtime > best_mtime:
                best = c
                best_mtime = mtime
        return best

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

        # Heuristic: If the newest N lines contain no reasoning items (e.g., huge tool outputs),
        # expand the replay window to find at least some reasoning for quick validation.
        max_lines = 5000
        replay_lines = max(0, int(last_lines))
        if replay_lines == 0:
            return

        total_ingested = 0
        while True:
            tail = self._read_tail_lines(path, last_lines=replay_lines)
            ingested = 0
            for bline in tail:
                self._line_no += 1
                ingested += self._handle_line(bline, file_path=path, line_no=self._line_no, is_replay=True)

            total_ingested += ingested
            if total_ingested > 0 or replay_lines >= max_lines:
                break
            replay_lines = min(max_lines, replay_lines * 5)

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

        ts = obj.get("timestamp") or ""
        top_type = obj.get("type")
        payload = obj.get("payload") or {}

        extracted: List[Dict[str, str]] = []

        if top_type == "response_item":
            # Assistant / User messages (final output and input echo)
            if payload.get("type") == "message":
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
                        extracted.append({"kind": f"{role}_message", "text": "\n".join(parts)})

            if payload.get("type") == "reasoning":
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
            ptype = payload.get("type")
            if ptype in ("function_call", "custom_tool_call", "web_search_call"):
                name = ""
                call_id = ""
                if isinstance(payload.get("name"), str):
                    name = payload.get("name") or ""
                if isinstance(payload.get("call_id"), str):
                    call_id = payload.get("call_id") or ""
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
                extracted.append(
                    {
                        "kind": "tool_call",
                        "text": f"{title}\n{prefix}{text}".rstrip(),
                    }
                )

            if ptype in ("function_call_output", "custom_tool_call_output"):
                call_id = payload.get("call_id") if isinstance(payload.get("call_id"), str) else ""
                out = payload.get("output")
                text = str(out or "")
                prefix = f"call_id={call_id}\n" if call_id else ""
                extracted.append(
                    {
                        "kind": "tool_output",
                        "text": f"{prefix}{text}".rstrip(),
                    }
                )

        if self._include_agent_reasoning and top_type == "event_msg":
            if payload.get("type") == "agent_reasoning":
                txt = payload.get("text")
                if isinstance(txt, str) and txt.strip():
                    extracted.append({"kind": "agent_reasoning", "text": txt})

        # User message echo in event stream (usually the most concise)
        if top_type == "event_msg":
            if payload.get("type") == "user_message":
                msg = payload.get("message")
                if isinstance(msg, str) and msg.strip():
                    extracted.append({"kind": "user_message", "text": msg})

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
                    self._enqueue_translation(mid=mid, text=text, thread_key=thread_key, batchable=is_replay)
        return ingested

    def _poll_tui_log(self) -> None:
        """
        Tail ~/.codex/log/codex-tui.log and emit tool gate status to UI.

        说明：
        - 该日志属于 Codex TUI 交互层；当需要用户在终端确认/授权时，rollout JSONL 可能暂时不再增长，
          导致 UI “看起来卡住”。这里把关键状态转成一条消息推送到 UI。
        - 为避免刷屏，只解析非常少量的关键行：ToolCall / waiting for tool gate / tool gate released。
        """
        path = self._tui_log_path
        try:
            if not path.exists():
                return
        except Exception:
            return

        # One-time init: scan tail for a "currently waiting" state.
        if not self._tui_inited:
            self._tui_inited = True
            try:
                st = path.stat()
                self._tui_offset = int(st.st_size)
            except Exception:
                self._tui_offset = 0
            try:
                tail = self._read_tail_lines(path, last_lines=240, max_bytes=2 * 1024 * 1024)
                self._tui_scan_gate_state(tail, synthetic_only=True)
            except Exception:
                pass

        try:
            st = path.stat()
            size = int(st.st_size)
        except Exception:
            return
        if self._tui_offset > size:
            # Truncated/rotated.
            self._tui_offset = 0
            self._tui_buf = b""

        try:
            with path.open("rb") as f:
                f.seek(self._tui_offset)
                chunk = f.read(256 * 1024)
                self._tui_offset = int(f.tell())
        except Exception:
            return
        if not chunk:
            return

        buf = self._tui_buf + chunk
        parts = buf.split(b"\n")
        self._tui_buf = parts.pop() if parts else b""
        if parts:
            self._tui_scan_gate_state(parts, synthetic_only=False)

    def _tui_scan_gate_state(self, lines: List[bytes], synthetic_only: bool) -> None:
        last_wait: Optional[Tuple[str, Optional[Dict[str, object]]]] = None
        gate_waiting = bool(self._tui_gate_waiting)
        last_toolcall = self._tui_last_toolcall

        for bline in lines:
            try:
                raw = bline.decode("utf-8", errors="replace")
            except Exception:
                continue
            line = _ANSI_RE.sub("", raw).strip("\r")
            if not line.strip():
                continue

            ts, msg = self._tui_split_ts(line)
            if not msg:
                continue

            toolcall = self._tui_parse_toolcall(msg)
            if toolcall is not None:
                toolcall["ts"] = ts
                last_toolcall = toolcall
                continue

            if "waiting for tool gate" in msg:
                gate_waiting = True
                last_wait = (ts, last_toolcall)
                if not synthetic_only:
                    self._emit_tool_gate(ts, waiting=True, toolcall=last_toolcall)
                continue

            if "tool gate released" in msg:
                if gate_waiting and not synthetic_only:
                    self._emit_tool_gate(ts, waiting=False, toolcall=last_toolcall)
                gate_waiting = False
                last_wait = None
                continue

        # If we're only doing a synthetic init scan, emit a single "still waiting" message.
        if synthetic_only and gate_waiting and last_wait is not None:
            ts, tc = last_wait
            self._emit_tool_gate(ts, waiting=True, toolcall=tc, synthetic=True)

        self._tui_last_toolcall = last_toolcall
        self._tui_gate_waiting = gate_waiting

    @staticmethod
    def _tui_split_ts(line: str) -> Tuple[str, str]:
        """
        codex-tui.log format (after stripping ANSI):
          2026-01-14T12:34:56.123Z  INFO waiting for tool gate
        """
        s = (line or "").lstrip()
        if not s:
            return ("", "")
        parts = s.split(" ", 1)
        if len(parts) < 2:
            return ("", s)
        ts = parts[0].strip()
        rest = parts[1].strip()
        if ts and ("T" in ts) and (ts[0:4].isdigit()):
            return (ts, rest)
        return ("", s)

    @staticmethod
    def _tui_parse_toolcall(msg: str) -> Optional[Dict[str, object]]:
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

    @staticmethod
    def _map_tui_tool_name(tool: str) -> str:
        t = str(tool or "").strip()
        if t == "shell":
            return "shell_command"
        return t or "tool"

    @staticmethod
    def _redact_secrets(s: str) -> str:
        # Best-effort redaction for common token formats.
        out = str(s or "")
        out = re.sub(r"\b(sk-[A-Za-z0-9]{8,})\b", "sk-***", out)
        out = re.sub(r"\b(bearer)\s+[A-Za-z0-9._-]{12,}\b", r"\1 ***", out, flags=re.IGNORECASE)
        return out

    def _format_tool_gate_md(self, waiting: bool, toolcall: Optional[Dict[str, object]]) -> str:
        icon = "⏸️" if waiting else "▶️"
        title = "终端等待确认（tool gate）" if waiting else "终端已确认（tool gate released）"
        lines = [f"{icon} {title}"]

        if toolcall:
            tool = self._map_tui_tool_name(str(toolcall.get("tool") or ""))
            payload = toolcall.get("payload") if isinstance(toolcall.get("payload"), dict) else None
            if tool:
                lines.append("")
                lines.append(f"- 工具：`{tool}`")
            if payload and isinstance(payload, dict):
                just = payload.get("justification")
                if isinstance(just, str) and just.strip():
                    lines.append(f"- 理由：{self._redact_secrets(just.strip())}")
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
                    cmd_s = self._redact_secrets(cmd_s.strip())
                    lines.append("")
                    lines.append("```")
                    lines.append(cmd_s)
                    lines.append("```")

        if waiting:
            lines.append("")
            lines.append("请回到终端完成确认/授权后，UI 才会继续刷新后续输出。")
        return "\n".join(lines).strip()

    def _emit_tool_gate(
        self,
        ts: str,
        waiting: bool,
        toolcall: Optional[Dict[str, object]],
        synthetic: bool = False,
    ) -> None:
        if not ts:
            try:
                ts = time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime())
            except Exception:
                ts = ""
        text = self._format_tool_gate_md(waiting=waiting, toolcall=toolcall)
        # Synthetic init scan: avoid spamming a "released" event, only show if waiting.
        if synthetic and not waiting:
            return

        file_path = str(self._tui_log_path)
        try:
            hid = _sha1_hex(f"{file_path}:tool_gate:{ts}:{text}")
        except Exception:
            hid = _sha1_hex(f"{file_path}:tool_gate::{text}")
        if self._dedupe(hid, kind="tool_gate"):
            return
        msg = {
            "id": hid[:16],
            "ts": ts,
            "kind": "tool_gate",
            "text": text,
            "zh": "",
            "thread_id": self._thread_id or "",
            "file": file_path,
            "line": 0,
        }
        try:
            self._ingest.ingest(msg)
        except Exception:
            return

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
