from __future__ import annotations

from typing import Any, Tuple


def normalize_translate_error(translator: Any, fallback: str) -> str:
    """
    Normalize translator.last_error into a short UI-friendly string.

    Semantics mirror the legacy TranslationPump._normalize_err():
      - Strip leading "WARN:" prefix
      - Fallback to provided message / "翻译失败"
      - Truncate to 240 chars with a trailing ellipsis
    """
    err = ""
    try:
        err = str(getattr(translator, "last_error", "") or "").strip()
    except Exception:
        err = ""
    if err.startswith("WARN:"):
        err = err[len("WARN:") :].strip()
    if not err:
        err = str(fallback or "").strip()
    if not err:
        err = "翻译失败"
    if len(err) > 240:
        err = err[:240] + "…"
    return err


def translate_one(translator: Any, text: str) -> Tuple[str, str]:
    """
    Translate a single text using the given translator.

    Returns: (zh, error)

    Important:
    - 翻译失败时不要把告警文本写入 `zh`（否则 UI 会把失败当作“已就绪”，污染内容区）
    - error 作为单独字段回填给 UI，用于状态 pill/重试提示
    """
    if not str(text or "").strip():
        return ("", "")
    try:
        out = translator.translate(text)
    except Exception as e:
        return ("", f"翻译异常：{type(e).__name__}")
    z = str(out or "").strip()
    if z:
        return (z, "")
    return ("", normalize_translate_error(translator, "翻译失败（返回空译文）"))

