from typing import Any, Callable, Dict, List, Set, Tuple


def emit_translate_batch(
    *,
    translator: Any,
    pairs: List[Tuple[str, str]],
    pack_translate_batch: Callable[[List[Tuple[str, str]]], str],
    unpack_translate_batch: Callable[[str, Set[str]], Dict[str, str]],
    translate_one: Callable[[str], Tuple[str, str]],
    normalize_err: Callable[[str], str],
    emit_translate: Callable[[str, str, str], None],
    done_id: Callable[[str], None],
    stop_requested: Callable[[], bool],
) -> int:
    """
    Execute a packed batch translation and emit per-item updates.

    Semantics intentionally mirror the previous TranslationPump._worker() implementation:
    - If the batch request returns empty output, emit an error for each item and DO NOT fallback to per-item
      translation (avoid request storms).
    - If unpack misses an item, fallback to per-item translation (bounded).
    - Respect stop_requested(): best-effort emit/done only for items processed before stop.

    Returns:
      processed_items: number of items emitted/done.
    """
    # Defensive: treat empty as no-op.
    if not isinstance(pairs, list) or len(pairs) <= 0:
        return 0

    wanted: Set[str] = set()
    for iid, _itxt in pairs:
        s = str(iid or "").strip()
        if s:
            wanted.add(s)

    packed = pack_translate_batch(pairs)
    out = ""
    try:
        out = translator.translate(packed)
    except Exception:
        out = ""

    processed = 0
    if not str(out or "").strip():
        berr = normalize_err("批量翻译失败")
        for iid, _itxt in pairs:
            if stop_requested():
                break
            mid = str(iid or "").strip()
            if not mid:
                continue
            emit_translate(mid, "", berr)
            processed += 1
            try:
                done_id(mid)
            except Exception:
                pass
        return processed

    mapping = unpack_translate_batch(out, wanted)
    # If the model fails to follow the marker protocol, fallback to per-item translation
    # (bounded by batch size) to avoid silent gaps in UI.
    fallback_budget = max(1, len(pairs))

    for iid, itxt in pairs:
        if stop_requested():
            break
        mid = str(iid or "").strip()
        if not mid:
            continue
        raw = mapping.get(mid) if isinstance(mapping, dict) else None
        z = str(raw or "").strip()
        if z:
            emit_translate(mid, z, "")
        else:
            # Missing/empty unpack: do a very limited fallback; otherwise surface an error for manual retry.
            if fallback_budget > 0:
                fallback_budget -= 1
                z2, e2 = translate_one(str(itxt or ""))
                emit_translate(mid, z2, e2)
            else:
                emit_translate(mid, "", "批量翻译解包缺失")
        processed += 1
        try:
            done_id(mid)
        except Exception:
            pass

    return processed

