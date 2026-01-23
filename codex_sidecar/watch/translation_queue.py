import threading
from collections import deque
from typing import Any, Deque, Dict, Optional, Set


class TranslationQueueState:
    """
    TranslationPump 的队列状态机（去重 + inflight + force_after）。

    设计目标：
    - 把“队列状态/并发细节”从 pump 主逻辑中拆出来，便于单测与后续演进。
    - 语义保持与历史实现一致：best-effort、失败不阻断、force 合并一次后续执行。
    """

    def __init__(self, *, max_seen_ids: int = 6000) -> None:
        try:
            n = int(max_seen_ids)
        except Exception:
            n = 6000
        self._seen_max = max(1000, n)
        self._seen: Set[str] = set()
        self._seen_order: Deque[str] = deque()

        self._inflight: Set[str] = set()
        self._force_after: Dict[str, Dict[str, Any]] = {}

        self._lock = threading.Lock()

    def seen_count(self) -> int:
        try:
            with self._lock:
                return int(len(self._seen))
        except Exception:
            return 0

    def is_inflight(self, mid: str) -> bool:
        iid = str(mid or "").strip()
        if not iid:
            return False
        try:
            with self._lock:
                return iid in self._inflight
        except Exception:
            return False

    def accept_or_reject_seen(self, mid: str) -> bool:
        """
        用于非 force 的自动翻译去重。

        返回值：
        - True  : 接受（并记录为已 seen）
        - False : 拒绝（已 seen）
        """
        iid = str(mid or "").strip()
        if not iid:
            return False
        try:
            with self._lock:
                if iid in self._seen:
                    return False
                self._seen.add(iid)
                self._seen_order.append(iid)
                while len(self._seen_order) > self._seen_max:
                    old = self._seen_order.popleft()
                    self._seen.discard(old)
            return True
        except Exception:
            # Best-effort: if bookkeeping fails, do not block enqueue.
            return True

    def mark_inflight(self, mid: str) -> None:
        iid = str(mid or "").strip()
        if not iid:
            return
        try:
            with self._lock:
                self._inflight.add(iid)
        except Exception:
            return

    def discard_inflight(self, mid: str) -> None:
        iid = str(mid or "").strip()
        if not iid:
            return
        try:
            with self._lock:
                self._inflight.discard(iid)
        except Exception:
            return

    def record_force_after_if_inflight(self, mid: str, follow_item: Dict[str, Any]) -> bool:
        """
        force 重译的合并逻辑：
        - 若该 id 正在 inflight，则不立即入队，而是记录 follow-up，等待 done_id 后再跑一次。

        返回值：
        - True  : 已合并（无需立即入队）
        - False : 当前不在 inflight，应按正常路径入队
        """
        iid = str(mid or "").strip()
        if not iid:
            return False
        try:
            with self._lock:
                if iid not in self._inflight:
                    return False
                self._force_after[iid] = follow_item
                return True
        except Exception:
            return False

    def done_id(self, mid: str) -> Optional[Dict[str, Any]]:
        """
        完成一个 id 的翻译处理：
        - 清理 inflight
        - 取出（并移除）待跟随执行的 force_after（如有）
        """
        iid = str(mid or "").strip()
        if not iid:
            return None
        try:
            with self._lock:
                self._inflight.discard(iid)
                return self._force_after.pop(iid, None)
        except Exception:
            return None

    def try_mark_inflight_for_follow(self, mid: str, follow_item: Dict[str, Any]) -> bool:
        """
        准备入队 follow-up：
        - 若已经 inflight，则再次合并并返回 False
        - 否则标记 inflight 并返回 True
        """
        iid = str(mid or "").strip()
        if not iid:
            return False
        try:
            with self._lock:
                if iid in self._inflight:
                    self._force_after[iid] = follow_item
                    return False
                self._inflight.add(iid)
                return True
        except Exception:
            return True

