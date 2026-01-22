import time
from typing import Any, Callable, Dict, List, Optional

from ..config import SidecarConfig
from ..translator import Translator


def translate_probe(
    *,
    cfg: SidecarConfig,
    build_translator: Callable[[SidecarConfig], Optional[Translator]],
    translator_error: Callable[[Translator], str],
    translator_model: Callable[[Translator, str], str],
) -> Dict[str, Any]:
    """
    Best-effort probe to validate the current translator configuration actually produces output.

    Notes:
    - Used by the UI after saving translator settings (no manual "test" button).
    - Does not return any secrets; errors are taken from translator.last_error (sanitized upstream).
    """
    provider = str(getattr(cfg, "translator_provider", "") or "openai").strip().lower()
    if provider not in ("openai", "nvidia", "http"):
        return {"ok": False, "provider": provider, "error": "unknown_provider"}

    # Keep it small but structurally rich (heading + code fence).
    sample = (
        "## Evaluating token limits\n\n"
        "Do NOT drop leading `#` in headings.\n\n"
        "```bash\n"
        "echo hello\n"
        "```\n\n"
        "中文说明：这行不应被翻译或改动。\n"
    )
    t0 = time.monotonic()
    tr = build_translator(cfg)
    if tr is None:
        return {"ok": False, "provider": provider, "error": "build_translator_failed"}

    out = ""
    try:
        out = tr.translate(sample)
    except Exception:
        out = ""
    ms = (time.monotonic() - t0) * 1000.0

    out_s = str(out or "").strip()
    err = translator_error(tr)

    # Basic format checks (primarily for NVIDIA, but fine for others too).
    heading_ok = ("##" in out_s) or ("\n#" in ("\n" + out_s))
    code_ok = "```" in out_s
    ok = bool(out_s)
    if provider == "nvidia":
        ok = ok and heading_ok and code_ok

    model = translator_model(tr, provider)
    if not model:
        model = provider

    return {
        "ok": bool(ok),
        "provider": provider,
        "model": model,
        "ms": float(ms),
        "sample_len": int(len(sample)),
        "out_len": int(len(out_s)),
        "heading_ok": bool(heading_ok),
        "code_ok": bool(code_ok),
        "error": err or ("empty_output" if not out_s else ""),
    }


def translate_text(
    *,
    cfg: SidecarConfig,
    build_translator: Callable[[SidecarConfig], Optional[Translator]],
    translator_error: Callable[[Translator], str],
    translator_model: Callable[[Translator, str], str],
    text: str,
) -> Dict[str, Any]:
    """
    Translate an arbitrary text blob (used by offline viewer / export backfill).

    Notes:
    - This does not depend on SidecarState, and does not mutate stored messages.
    - Returned payload is intentionally small and secret-free.
    """
    src = str(text or "")
    if not src.strip():
        return {"ok": False, "error": "empty_text"}

    provider = str(getattr(cfg, "translator_provider", "") or "openai").strip().lower() or "openai"

    t0 = time.monotonic()
    tr = build_translator(cfg)
    if tr is None:
        return {"ok": False, "provider": provider, "error": "build_translator_failed"}

    out = ""
    try:
        out = tr.translate(src)
    except Exception:
        out = ""
    ms = (time.monotonic() - t0) * 1000.0

    out_s = str(out or "").strip()
    err = translator_error(tr)
    model = translator_model(tr, provider)
    if not model:
        model = provider

    return {
        "ok": bool(out_s),
        "provider": provider,
        "model": model,
        "ms": float(ms),
        "zh": out_s,
        "error": err or ("empty_output" if not out_s else ""),
    }


def translate_items(
    *,
    cfg: SidecarConfig,
    build_translator: Callable[[SidecarConfig], Optional[Translator]],
    translator_error: Callable[[Translator], str],
    translator_model: Callable[[Translator, str], str],
    items: Any,
) -> Dict[str, Any]:
    """
    Batch-translate multiple items using a single translator instance.

    Input:
      items: [{id, text}, ...]

    Output:
      { ok, provider, model, ms, items:[{id, ok, zh, error, ms, provider, model}] }

    Notes:
    - This does not depend on SidecarState, and does not mutate stored messages.
    - Returned payload is intentionally small and secret-free.
    """
    arr = items if isinstance(items, list) else []
    if not arr:
        return {"ok": False, "error": "empty_items", "items": []}

    norm: List[Dict[str, str]] = []
    for it in arr[:64]:
        if not isinstance(it, dict):
            continue
        mid = str(it.get("id") or "").strip()
        text = str(it.get("text") or "")
        if not mid and not str(text or "").strip():
            continue
        norm.append({"id": mid, "text": text})
    if not norm:
        return {"ok": False, "error": "empty_items", "items": []}

    provider = str(getattr(cfg, "translator_provider", "") or "openai").strip().lower() or "openai"

    t0_all = time.monotonic()
    tr = build_translator(cfg)
    if tr is None:
        return {"ok": False, "provider": provider, "error": "build_translator_failed", "items": []}

    model = translator_model(tr, provider)
    if not model:
        model = provider

    out_items: List[Dict[str, Any]] = []
    for it in norm:
        mid = str(it.get("id") or "").strip()
        src = str(it.get("text") or "")
        if not str(src or "").strip():
            out_items.append({"id": mid, "ok": False, "provider": provider, "model": model, "ms": 0.0, "zh": "", "error": "empty_text"})
            continue
        t0 = time.monotonic()
        out = ""
        try:
            out = tr.translate(src)
        except Exception:
            out = ""
        ms = (time.monotonic() - t0) * 1000.0
        out_s = str(out or "").strip()
        err = translator_error(tr)
        out_items.append(
            {
                "id": mid,
                "ok": bool(out_s),
                "provider": provider,
                "model": model,
                "ms": float(ms),
                "zh": out_s,
                "error": err or ("empty_output" if not out_s else ""),
            }
        )

    return {
        "ok": True,
        "provider": provider,
        "model": model,
        "ms": float((time.monotonic() - t0_all) * 1000.0),
        "items": out_items,
    }

