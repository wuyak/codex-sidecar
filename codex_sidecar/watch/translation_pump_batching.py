import queue
from typing import Any, Deque, Dict, List


def collect_batch_from_lo(
    first_item: Dict[str, Any],
    *,
    lo_queue: "queue.Queue[Dict[str, Any]]",
    pending: Deque[Dict[str, Any]],
    batch_size: int,
) -> List[Dict[str, Any]]:
    """
    Collect a translation batch from the low-priority queue.

    Behavior (kept consistent with legacy TranslationPump._worker):
    - Only aggregate when first_item is batchable AND has a non-empty key.
    - Consume up to batch_size items from lo_queue with the same key.
    - Items that don't match are appended to pending for later processing.
    """
    batch: List[Dict[str, Any]] = [first_item]

    try:
        batchable = bool(first_item.get("batchable"))
        key = str(first_item.get("key") or "")
        tr = first_item.get("_tr", None)
    except Exception:
        batchable = False
        key = ""
        tr = None

    if (not batchable) or (not key):
        return batch

    lim = max(1, int(batch_size or 1))
    while len(batch) < lim:
        try:
            nxt = lo_queue.get_nowait()
        except queue.Empty:
            break
        except Exception:
            break
        try:
            if bool(nxt.get("batchable")) and str(nxt.get("key") or "") == key and nxt.get("_tr", None) is tr:
                batch.append(nxt)
            else:
                pending.append(nxt)
        except Exception:
            pending.append(nxt)

    return batch
