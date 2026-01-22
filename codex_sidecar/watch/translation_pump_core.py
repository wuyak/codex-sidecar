import queue
import threading
import time
from collections import deque
from typing import Any, Callable, Deque, Dict, List, Optional, Set, Tuple

from ..translator import Translator
from .translate_batch import _pack_translate_batch, _unpack_translate_batch
from .translation_queue import TranslationQueueState


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

    def _translate_one(self, text: str) -> Tuple[str, str]:
        """
        Return (zh, error).

        Important:
        - 翻译失败时不要把告警文本写入 `zh`（否则 UI 会把失败当作“已就绪”，污染内容区）
        - error 作为单独字段回填给 UI，用于状态 pill/重试提示
        """
        if not str(text or "").strip():
            return ("", "")
        try:
            out = self._translator.translate(text)
        except Exception as e:
            return ("", f"翻译异常：{type(e).__name__}")
        z = str(out or "").strip()
        if z:
            return (z, "")
        return ("", self._normalize_err("翻译失败（返回空译文）"))

    def _normalize_err(self, fallback: str) -> str:
        err = str(getattr(self._translator, "last_error", "") or "").strip()
        if err.startswith("WARN:"):
            err = err[len("WARN:") :].strip()
        if not err:
            err = str(fallback or "").strip()
        if not err:
            err = "翻译失败"
        # Keep it bounded (UI uses it as a tooltip; overlong strings are noisy).
        if len(err) > 240:
            err = err[:240] + "…"
        return err

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

            batch: List[Dict[str, Any]] = [item]
            if batchable and key:
                while len(batch) < self._batch_size:
                    try:
                        nxt = self._lo.get_nowait()
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

            t0 = time.monotonic()
            try:
                if len(batch) == 1:
                    zh, err = self._translate_one(text)
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
                    zh, err = self._translate_one(text)
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
                        for it in batch:
                            if not isinstance(it, dict):
                                continue
                            iid = str(it.get("id") or "").strip()
                            if iid:
                                self._done_id(iid)
                    except Exception:
                        try:
                            self._done_id(mid)
                        except Exception:
                            pass
                    continue

                packed = _pack_translate_batch(pairs)
                out = ""
                try:
                    out = self._translator.translate(packed)
                except Exception:
                    out = ""
                if not str(out or "").strip():
                    # Batch request failed; mark all as error (do not fallback to per-item to avoid request storms).
                    berr = self._normalize_err("批量翻译失败")
                    for iid, _itxt in pairs:
                        if stop_event.is_set():
                            break
                        self._emit_translate(iid, "", berr)
                        self._done_items += 1
                        try:
                            self._done_id(iid)
                        except Exception:
                            pass
                    self._done_batches += 1
                    self._last_batch_n = len(pairs)
                    self._last_translate_ms = (time.monotonic() - t0) * 1000.0
                    self._last_key = key
                    self._last_ts = time.time()
                    continue

                mapping = _unpack_translate_batch(out, wanted_ids=wanted)
                # If the model fails to follow the marker protocol, fallback to per-item translation
                # (bounded by batch size) to avoid silent gaps in UI.
                fallback_budget = max(1, len(pairs))

                for iid, itxt in pairs:
                    if stop_event.is_set():
                        break
                    raw = mapping.get(iid) if isinstance(mapping, dict) else None
                    z = str(raw or "").strip()
                    if z:
                        self._emit_translate(iid, z, "")
                    else:
                        # Missing/empty unpack: do a very limited fallback; otherwise surface an error for manual retry.
                        if fallback_budget > 0:
                            fallback_budget -= 1
                            z2, e2 = self._translate_one(itxt)
                            self._emit_translate(iid, z2, e2)
                        else:
                            self._emit_translate(iid, "", "批量翻译解包缺失")
                    self._done_items += 1
                    try:
                        self._done_id(iid)
                    except Exception:
                        pass
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
                    for it in batch:
                        if not isinstance(it, dict):
                            continue
                        iid = str(it.get("id") or "").strip()
                        if iid:
                            self._done_id(iid)
                except Exception:
                    pass
                continue
