from __future__ import annotations

from typing import Any


def translator_error(tr: Any) -> str:
    err = ""
    try:
        err = str(getattr(tr, "last_error", "") or "").strip()
    except Exception:
        err = ""
    if err.startswith("WARN:"):
        err = err[len("WARN:") :].strip()
    return err


def translator_model(tr: Any, provider_fallback: str) -> str:
    model = ""
    try:
        model = str(getattr(tr, "_resolved_model", "") or getattr(tr, "model", "") or "").strip()
    except Exception:
        model = ""
    if not model:
        model = str(provider_fallback or "").strip()
    return model

