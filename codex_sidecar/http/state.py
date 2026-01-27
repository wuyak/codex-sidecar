import queue
import threading
import time
from collections import deque
from typing import Deque, Dict, List, Optional


class _Broadcaster:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._subscribers: List["queue.Queue[dict]"] = []

    @staticmethod
    def _is_high_priority(msg: dict) -> bool:
        """
        High-priority events should survive SSE backpressure.

        Rationale:
        - UI notifications depend on receiving these events in real time.
        - SSE subscriber queues are bounded; if the browser can't keep up, we
          prefer dropping low-value noise (e.g. translation backfill updates)
          rather than terminal approval / final assistant output.
        """
        try:
            op = str(msg.get("op") or "").strip().lower()
        except Exception:
            op = ""
        if op == "update":
            return False
        try:
            kind = str(msg.get("kind") or "").strip()
        except Exception:
            kind = ""
        return kind in ("tool_gate", "assistant_message")

    def subscribe(self) -> "queue.Queue[dict]":
        q: "queue.Queue[dict]" = queue.Queue(maxsize=256)
        with self._lock:
            self._subscribers.append(q)
        return q

    def unsubscribe(self, q: "queue.Queue[dict]") -> None:
        with self._lock:
            try:
                self._subscribers.remove(q)
            except ValueError:
                return

    def publish(self, msg: dict) -> None:
        high = self._is_high_priority(msg) if isinstance(msg, dict) else False
        with self._lock:
            subs = list(self._subscribers)
        for q in subs:
            try:
                q.put_nowait(msg)
            except queue.Full:
                # Client can't keep up:
                # - For low-priority events, drop to avoid blocking producers.
                # - For high-priority events, evict one oldest item to make room.
                if not high:
                    continue
                try:
                    _ = q.get_nowait()
                except queue.Empty:
                    continue
                try:
                    q.put_nowait(msg)
                except queue.Full:
                    continue


class SidecarState:
    def __init__(self, max_messages: int) -> None:
        self._lock = threading.Lock()
        self._max_messages = max(1, int(max_messages or 1000))
        self._messages: Deque[dict] = deque()
        self._by_id: Dict[str, dict] = {}
        self._next_seq = 1
        self._broadcaster = _Broadcaster()

    def add(self, msg: dict) -> None:
        op = ""
        try:
            op = str(msg.get("op") or "").strip().lower()
        except Exception:
            op = ""
        if op == "update":
            self.update(msg)
            return

        mid = ""
        try:
            mid = str(msg.get("id") or "")
        except Exception:
            mid = ""

        added = False
        with self._lock:
            if mid and mid in self._by_id:
                added = False
            else:
                # Enforce bounded history while keeping id-set in sync.
                while len(self._messages) >= self._max_messages:
                    old = self._messages.popleft()
                    try:
                        oid = str(old.get("id") or "")
                        if oid:
                            self._by_id.pop(oid, None)
                    except Exception:
                        pass
                try:
                    msg["seq"] = int(self._next_seq)
                    self._next_seq += 1
                except Exception:
                    try:
                        msg["seq"] = int(time.time() * 1000)
                    except Exception:
                        pass
                self._messages.append(msg)
                if mid:
                    self._by_id[mid] = msg
                added = True
        if added:
            self._broadcaster.publish(msg)

    def update(self, patch: dict) -> None:
        mid = ""
        try:
            mid = str(patch.get("id") or "")
        except Exception:
            mid = ""
        if not mid:
            return

        out: Optional[dict] = None
        with self._lock:
            cur = self._by_id.get(mid)
            if cur is None:
                # If update arrives before initial add (shouldn't happen), ignore.
                out = None
            else:
                seq = cur.get("seq")
                for k, v in patch.items():
                    if k in ("op", "id", "seq"):
                        continue
                    cur[k] = v
                if seq is not None:
                    cur["seq"] = seq
                out = dict(cur)
                out["op"] = "update"

        if out is not None:
            self._broadcaster.publish(out)

    def clear(self) -> None:
        with self._lock:
            self._messages.clear()
            self._by_id.clear()

    def list_messages(self) -> List[dict]:
        with self._lock:
            return list(self._messages)

    def get_message(self, mid: str) -> Optional[dict]:
        """
        Fetch a message by id (best-effort copy).
        """
        k = str(mid or "")
        if not k:
            return None
        with self._lock:
            cur = self._by_id.get(k)
            return dict(cur) if isinstance(cur, dict) else None

    def list_threads(self) -> List[dict]:
        with self._lock:
            msgs = list(self._messages)
        agg: Dict[str, dict] = {}
        for m in msgs:
            thread_id = str(m.get("thread_id") or "")
            file_path = str(m.get("file") or "")
            key = thread_id or file_path or "unknown"
            if key not in agg:
                agg[key] = {
                    "key": key,
                    "thread_id": thread_id,
                    "file": file_path,
                    "count": 0,
                    "last_ts": "",
                    "last_seq": 0,
                    "kinds": {},
                    "source_kind": "",
                    "parent_thread_id": "",
                    "subagent_depth": 0,
                }
            a = agg[key]
            a["count"] += 1
            ts = str(m.get("ts") or "")
            if ts and (not a["last_ts"] or ts > a["last_ts"]):
                a["last_ts"] = ts
            try:
                seq = int(m.get("seq") or 0)
            except Exception:
                seq = 0
            if seq and seq > int(a.get("last_seq") or 0):
                a["last_seq"] = seq
            kind = str(m.get("kind") or "")
            if kind:
                a["kinds"][kind] = int(a["kinds"].get(kind, 0)) + 1

            # Best-effort session metadata (e.g. subagent parent linkage).
            try:
                sk = str(m.get("source_kind") or "").strip()
            except Exception:
                sk = ""
            if sk and not str(a.get("source_kind") or "").strip():
                a["source_kind"] = sk
            try:
                pid = str(m.get("parent_thread_id") or "").strip()
            except Exception:
                pid = ""
            if pid and not str(a.get("parent_thread_id") or "").strip():
                a["parent_thread_id"] = pid
            try:
                depth = m.get("subagent_depth")
                if isinstance(depth, int):
                    a["subagent_depth"] = int(depth)
                elif isinstance(depth, str) and str(depth).strip().isdigit():
                    a["subagent_depth"] = int(str(depth).strip())
            except Exception:
                pass
        items = list(agg.values())
        items.sort(key=lambda x: (int(x.get("last_seq") or 0), x.get("last_ts") or ""), reverse=True)
        return items

    def subscribe(self) -> "queue.Queue[dict]":
        return self._broadcaster.subscribe()

    def unsubscribe(self, q: "queue.Queue[dict]") -> None:
        self._broadcaster.unsubscribe(q)
