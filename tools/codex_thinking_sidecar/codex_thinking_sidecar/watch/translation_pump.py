import queue
import threading
from collections import deque
from typing import Any, Callable, Deque, Dict, List, Optional, Set, Tuple

from ..translator import NoneTranslator, Translator
from .translate_batch import _pack_translate_batch, _unpack_translate_batch


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

        # Best-effort de-dupe: avoid queuing the same id repeatedly.
        self._seen: Set[str] = set()
        self._seen_order: Deque[str] = deque()
        self._seen_max = max(1000, int(max_seen_ids or 6000))

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

    def enqueue(self, mid: str, text: str, thread_key: str, batchable: bool) -> None:
        m = str(mid or "").strip()
        t = str(text or "")
        if not m or not t.strip():
            return

        # Dedupe (bounded).
        if m in self._seen:
            return
        self._seen.add(m)
        self._seen_order.append(m)
        while len(self._seen_order) > self._seen_max:
            old = self._seen_order.popleft()
            self._seen.discard(old)

        item: Dict[str, Any] = {
            "id": m,
            "text": t,
            "key": str(thread_key or ""),
            "batchable": bool(batchable),
        }

        q = self._lo if batchable else self._hi
        self._put_drop_oldest(q, item)

    @staticmethod
    def _put_drop_oldest(q: "queue.Queue[Dict[str, Any]]", item: Dict[str, Any]) -> None:
        try:
            q.put_nowait(item)
            return
        except queue.Full:
            pass
        except Exception:
            return
        # Backpressure: drop one oldest item and retry once.
        try:
            _ = q.get_nowait()
        except Exception:
            return
        try:
            q.put_nowait(item)
        except Exception:
            return

    def _normalize_translation(self, src: str, zh: str) -> str:
        s = str(src or "")
        z = str(zh or "")
        if s.strip() and (not z.strip()) and not isinstance(self._translator, NoneTranslator):
            err = str(getattr(self._translator, "last_error", "") or "").strip()
            hint = err if err else "WARN: 翻译失败（返回空译文）"
            return f"⚠️ {hint}\n\n{s}"
        return z

    def _emit_zh(self, mid: str, src: str, zh: str) -> None:
        # NoneTranslator: avoid emitting no-op updates that only cause extra DOM work.
        if isinstance(self._translator, NoneTranslator) and (not str(zh or "").strip()):
            return
        try:
            self._emit_update({"op": "update", "id": mid, "zh": zh})
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

            try:
                if len(batch) == 1:
                    zh = self._normalize_translation(text, self._translator.translate(text))
                    if stop_event.is_set():
                        continue
                    self._emit_zh(mid, text, zh)
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
                    self._emit_zh(mid, text, zh)
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
                    self._emit_zh(iid, itxt, zh)
            except Exception:
                continue
