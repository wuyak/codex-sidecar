from typing import Iterable, List, Tuple


def collect_pairs(batch: Iterable[object]) -> List[Tuple[str, str]]:
    pairs: List[Tuple[str, str]] = []
    for it in batch:
        if not isinstance(it, dict):
            continue
        try:
            iid = str(it.get("id") or "").strip()
            itxt = str(it.get("text") or "")
        except Exception:
            continue
        if not iid or not itxt.strip():
            continue
        pairs.append((iid, itxt))
    return pairs


def collect_ids(batch: Iterable[object]) -> List[str]:
    ids: List[str] = []
    for it in batch:
        if not isinstance(it, dict):
            continue
        try:
            iid = str(it.get("id") or "").strip()
        except Exception:
            iid = ""
        if iid:
            ids.append(iid)
    return ids
