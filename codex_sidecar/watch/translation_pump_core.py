import queue
import threading
import time
from collections import deque
from typing import Any, Callable, Deque, Dict, List, Optional, Tuple

from ..translator import Translator
from .translate_batch import _pack_translate_batch, _unpack_translate_batch
from .translation_batch_worker import emit_translate_batch
from .translation_queue import TranslationQueueState
from .translation_pump_batching import collect_batch_from_lo
from .translation_pump_items import collect_ids, collect_pairs
from .translation_pump_translate import normalize_translate_error, translate_one


class TranslationPump:
    """
    后台翻译队列：
    - 采集/入库优先：先推送英文原文到 UI
    - 翻译异步回填：完成后以 op=update 回填到同一条消息（id 不变）
    - 回放导入期可聚合：同一会话 key 内最多批量翻译 N 条，避免跨会话串流
    - 实时优先：非 batchable 的实时翻译走高优先级队列，避免被导入积压拖慢
    """

    def __init__(
        self,
        translator: Translator,
        emit_update: Callable[[Dict[str, Any]], bool],
        *,
        batch_size: int = 5,
        max_queue: int = 1000,
        max_seen_ids: int = 6000,
    ) -> None:
        self._translator = translator
        self._emit_update = emit_update
        self._batch_size = max(1, int(batch_size or 5))

        # Two-tier queue:
        # - hi: realtime (non-batchable) updates should stay responsive
        # - lo: replay/import backlog (batchable) can be processed opportunistically
        qmax = max(50, int(max_queue or 1000))
        self._hi: "queue.Queue[Dict[str, Any]]" = queue.Queue(maxsize=max(10, min(200, qmax // 5)))
        self._lo: "queue.Queue[Dict[str, Any]]" = queue.Queue(maxsize=qmax)
        self._pending: Deque[Dict[str, Any]] = deque()

        self._thread: Optional[threading.Thread] = None

        # Queue state machine: seen/inflight/force_after.
        self._qstate = TranslationQueueState(max_seen_ids=max_seen_ids)

        # Observability (best-effort; approximate counters are fine for a sidecar).
        self._drop_old_hi = 0
        self._drop_old_lo = 0
        self._drop_new_hi = 0
        self._drop_new_lo = 0
        self._done_items = 0
        self._done_batches = 0
        self._last_batch_n = 0
        self._last_translate_ms = 0.0
        self._last_key = ""
        self._last_ts = 0.0

    def start(self, stop_event: threading.Event) -> None:
        if self._thread is not None and self._thread.is_alive():
            return
        t = threading.Thread(
            target=self._worker,
            args=(stop_event,),
            name="sidecar-translate",
            daemon=True,
        )
        t.start()
        self._thread = t

    def set_translator(self, translator: Translator) -> None:
        """
        Hot-reload translator implementation at runtime.

        Notes:
        - Assignment is atomic; the worker thread will use the new translator for subsequent items.
        - In-flight requests may still be running on the old translator instance.
        """
        try:
            self._translator = translator
        except Exception:
            return

    def enqueue(
        self,
        mid: str,
        text: str,
        thread_key: str,
        batchable: bool,
        *,
        force: bool = False,
        fallback_zh: str = "",
    ) -> bool:
        m = str(mid or "").strip()
        t = str(text or "")
        if not m or not t.strip():
            return False

        # Dedupe (bounded).
        # - Normal auto-translate: skip if we've seen this message id before.
        # - Force retranslate: coalesce if already queued/running (run once after inflight).
        if force:
            follow_item: Dict[str, Any] = {"id": m, "text": t, "key": str(thread_key or ""), "batchable": False}
            fz = str(fallback_zh or "")
            if fz.strip():
                follow_item["fallback_zh"] = fz
            try:
                if self._qstate.record_force_after_if_inflight(m, follow_item):
                    return True
            except Exception:
                pass
        else:
            try:
                if not self._qstate.accept_or_reject_seen(m):
                    return False
            except Exception:
                pass

        item: Dict[str, Any] = {
            "id": m,
            "text": t,
            "key": str(thread_key or ""),
            "batchable": bool(batchable),
        }
        if force:
            fz = str(fallback_zh or "")
            if fz.strip():
                item["fallback_zh"] = fz

        q = self._lo if batchable else self._hi
        try:
            self._qstate.mark_inflight(m)
        except Exception:
            pass
        return bool(self._put_drop_oldest(q, item, is_hi=(not batchable)))

    def _put_drop_oldest(self, q: "queue.Queue[Dict[str, Any]]", item: Dict[str, Any], *, is_hi: bool) -> bool:
        iid = ""
        try:
            iid = str(item.get("id") or "").strip()
        except Exception:
            iid = ""
        try:
            q.put_nowait(item)
            return True
        except queue.Full:
            pass
        except Exception:
            if iid:
                try:
                    self._qstate.discard_inflight(iid)
                except Exception:
                    pass
            return False
        # Backpressure: drop one oldest item and retry once.
        try:
            old = q.get_nowait()
            try:
                oid = str(old.get("id") or "").strip() if isinstance(old, dict) else ""
            except Exception:
                oid = ""
            if oid:
                try:
                    self._qstate.discard_inflight(oid)
                except Exception:
                    pass
            if is_hi:
                self._drop_old_hi += 1
            else:
                self._drop_old_lo += 1
        except Exception:
            if iid:
                try:
                    self._qstate.discard_inflight(iid)
                except Exception:
                    pass
            return False
        try:
            q.put_nowait(item)
            return True
        except Exception:
            if is_hi:
                self._drop_new_hi += 1
            else:
                self._drop_new_lo += 1
            if iid:
                try:
                    self._qstate.discard_inflight(iid)
                except Exception:
                    pass
            return False

    def _done_id(self, mid: str) -> None:
        """
        Mark an id as done (clears inflight) and enqueue a coalesced force retranslate if present.
        """
        iid = str(mid or "").strip()
        if not iid:
            return
        follow: Optional[Dict[str, Any]] = None
        try:
            follow = self._qstate.done_id(iid)
        except Exception:
            follow = None
        if not isinstance(follow, dict) or not str(follow.get("text") or "").strip():
            return
        # Requeue follow-up as hi-priority (manual).
        try:
            if not self._qstate.try_mark_inflight_for_follow(iid, follow):
                return
        except Exception:
            pass
        try:
            ok = bool(self._put_drop_oldest(self._hi, follow, is_hi=True))
            if not ok:
                try:
                    self._qstate.discard_inflight(iid)
                except Exception:
                    pass
        except Exception:
            try:
                self._qstate.discard_inflight(iid)
            except Exception:
                pass

    def stats(self) -> Dict[str, Any]:
        try:
            hi = int(self._hi.qsize())
        except Exception:
            hi = -1
        try:
            lo = int(self._lo.qsize())
        except Exception:
            lo = -1
        try:
            pending = len(self._pending)
        except Exception:
            pending = 0
        try:
            seen = int(self._qstate.seen_count())
        except Exception:
            seen = 0
        try:
            last_err = str(getattr(self._translator, "last_error", "") or "")
        except Exception:
            last_err = ""
        return {
            "hi_q": hi,
            "lo_q": lo,
            "pending": pending,
            "seen": seen,
            "drop_old_hi": int(self._drop_old_hi),
            "drop_old_lo": int(self._drop_old_lo),
            "drop_new_hi": int(self._drop_new_hi),
            "drop_new_lo": int(self._drop_new_lo),
            "done_items": int(self._done_items),
            "done_batches": int(self._done_batches),
            "last_batch_n": int(self._last_batch_n),
            "last_translate_ms": float(self._last_translate_ms),
            "last_key": str(self._last_key or ""),
            "last_error": last_err,
        }

    def _emit_translate(self, mid: str, zh: str, err: str) -> None:
        try:
            self._emit_update({"op": "update", "id": mid, "zh": zh, "translate_error": err})
        except Exception:
            return

    def _worker(self, stop_event: threading.Event) -> None:
        pending = self._pending
        while not stop_event.is_set():
            try:
                if pending:
                    item = pending.popleft()
                else:
                    try:
                        item = self._hi.get(timeout=0.05)
                    except queue.Empty:
                        item = self._lo.get(timeout=0.2)
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

            batch = collect_batch_from_lo(item, lo_queue=self._lo, pending=pending, batch_size=self._batch_size)

            t0 = time.monotonic()
            try:
                if len(batch) == 1:
                    zh, err = translate_one(self._translator, text)
                    if stop_event.is_set():
                        continue
                    if (not str(zh or "").strip()) and str(err or "").strip():
                        try:
                            fz = str(item.get("fallback_zh") or "")
                        except Exception:
                            fz = ""
                        if fz.strip():
                            zh = fz
                    self._emit_translate(mid, zh, err)
                    self._done_items += 1
                    self._done_batches += 1
                    self._last_batch_n = 1
                    self._last_translate_ms = (time.monotonic() - t0) * 1000.0
                    self._last_key = key
                    self._last_ts = time.time()
                    try:
                        self._done_id(mid)
                    except Exception:
                        pass
                    continue

                pairs = collect_pairs(batch)
                if len(pairs) <= 1:
                    zh, err = translate_one(self._translator, text)
                    if stop_event.is_set():
                        continue
                    self._emit_translate(mid, zh, err)
                    self._done_items += 1
                    self._done_batches += 1
                    self._last_batch_n = 1
                    self._last_translate_ms = (time.monotonic() - t0) * 1000.0
                    self._last_key = key
                    self._last_ts = time.time()
                    try:
                        for iid in collect_ids(batch):
                            self._done_id(iid)
                    except Exception:
                        try:
                            self._done_id(mid)
                        except Exception:
                            pass
                    continue

                processed = emit_translate_batch(
                    translator=self._translator,
                    pairs=pairs,
                    pack_translate_batch=_pack_translate_batch,
                    unpack_translate_batch=_unpack_translate_batch,
                    translate_one=lambda t: translate_one(self._translator, t),
                    normalize_err=lambda f: normalize_translate_error(self._translator, f),
                    emit_translate=self._emit_translate,
                    done_id=self._done_id,
                    stop_requested=stop_event.is_set,
                )
                self._done_items += int(processed)
                self._done_batches += 1
                self._last_batch_n = len(pairs)
                self._last_translate_ms = (time.monotonic() - t0) * 1000.0
                self._last_key = key
                self._last_ts = time.time()
            except Exception:
                # Best-effort cleanup: allow future retries even if a batch fails.
                try:
                    self._done_id(mid)
                except Exception:
                    pass
                try:
                    for iid in collect_ids(batch):
                        self._done_id(iid)
                except Exception:
                    pass
                continue
