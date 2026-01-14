import hashlib
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Pattern, Set, Tuple

from .translator import NoneTranslator, Translator


_ROLLOUT_RE = re.compile(
    r"^rollout-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-([0-9a-fA-F-]{36})\.jsonl$"
)
_PROC_ROOT = Path("/proc")


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

    def status(self) -> Dict[str, str]:
        return {
            "current_file": str(self._current_file) if self._current_file is not None else "",
            "thread_id": self._thread_id or "",
            "offset": str(self._offset),
            "line_no": str(self._line_no),
            "last_error": self._last_error or "",
            "follow_mode": self._follow_mode or "",
            "codex_detected": "1" if self._codex_detected else "0",
            "codex_pids": ",".join(str(x) for x in self._codex_pids[:8]),
            "codex_process_regex": self._codex_process_regex_raw,
            "process_file": str(self._process_file) if self._process_file is not None else "",
        }

    def run(self, stop_event) -> None:
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
            if now - self._last_file_scan_ts >= self._file_scan_interval_s:
                self._switch_to_latest_if_needed(force=False)
                self._last_file_scan_ts = now
            self._poll_once()
            stop_event.wait(self._poll_interval_s)

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

        if not self._follow_codex_process:
            self._follow_mode = "legacy"
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
                ingested += self._handle_line(bline, file_path=path, line_no=self._line_no)

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
                    bline = f.readline()
                    if not bline:
                        break
                    self._offset = f.tell()
                    self._line_no += 1
                    self._handle_line(bline.rstrip(b"\n"), file_path=path, line_no=self._line_no)
        except Exception:
            try:
                self._last_error = "poll_failed"
            except Exception:
                pass
            return

    def _handle_line(self, bline: bytes, file_path: Path, line_no: int) -> int:
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
            # Only translate "thinking" content; keep tool/user/assistant as-is.
            #
            # NOTE: translate after dedupe to avoid wasting API calls on duplicates.
            if kind in ("reasoning_summary", "agent_reasoning"):
                zh = self._translator.translate(text)
                if text.strip() and not zh.strip() and not isinstance(self._translator, NoneTranslator):
                    err = str(getattr(self._translator, "last_error", "") or "").strip()
                    hint = err if err else "WARN: 翻译失败（返回空译文）"
                    zh = f"⚠️ {hint}\n\n{text}"
            else:
                zh = ""
            msg = {
                "id": hid[:16],
                "ts": ts,
                "kind": kind,
                "text": text,
                "zh": zh,
                "thread_id": self._thread_id or "",
                "file": str(file_path),
                "line": line_no,
            }
            if self._ingest.ingest(msg):
                ingested += 1
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
