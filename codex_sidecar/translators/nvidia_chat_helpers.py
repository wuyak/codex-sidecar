import json
import re

from .utils import log_warn, sanitize_url
from .batch_prompt import looks_like_translate_batch_prompt as _looks_like_translate_batch_prompt

_CTX_LIMIT_RE = re.compile(
    r"maximum context length is\s+(\d+)\s+tokens.*?\(\s*(\d+)\s+in the messages",
    re.IGNORECASE | re.DOTALL,
)

_UNTRANSLATED_PATTERNS = (
    "translate the following",
    "output only the translation",
    "format requirements",
    "you are a translator",
)

_MD_FENCE_RE = re.compile(r"^\s*```")
_MD_HEADING_RE = re.compile(r"^\s*#{1,6}\s+\S")


def _content_to_text(content) -> str:
    """
    Best-effort coercion for Chat Completions content.

    Some gateways return:
      - message.content as str
      - message.content as list[{"type":"text","text":"..."}]
    """
    if isinstance(content, str):
        return content
    if isinstance(content, dict):
        t = content.get("text")
        if isinstance(t, str):
            return t
        t2 = content.get("content")
        if isinstance(t2, str):
            return t2
        return ""
    if isinstance(content, list):
        parts = []
        for part in content:
            if isinstance(part, str):
                if part:
                    parts.append(part)
                continue
            if isinstance(part, dict):
                t = part.get("text")
                if isinstance(t, str) and t:
                    parts.append(t)
                    continue
                t2 = part.get("content")
                if isinstance(t2, str) and t2:
                    parts.append(t2)
                    continue
        return "".join(parts)
    return ""


def _extract_chat_completions_text(obj) -> str:
    if not isinstance(obj, dict):
        return ""
    choices = obj.get("choices")
    if isinstance(choices, list) and choices:
        for ch in choices:
            if not isinstance(ch, dict):
                continue
            msg = ch.get("message")
            if isinstance(msg, dict):
                c = _content_to_text(msg.get("content"))
                if isinstance(c, str) and c.strip():
                    return c
            # streaming-like deltas (some gateways)
            delta = ch.get("delta")
            if isinstance(delta, dict):
                c = _content_to_text(delta.get("content"))
                if isinstance(c, str) and c.strip():
                    return c
            t = ch.get("text")
            if isinstance(t, str) and t.strip():
                return t
    # best-effort fallbacks
    for k in ("text", "result", "output", "translation"):
        v = obj.get(k)
        if isinstance(v, str) and v.strip():
            return v
    return ""


def _format_nvidia_translate_error(url: str, detail: str = "") -> str:
    safe = sanitize_url(url, auth_token="")
    suffix = f" ({detail})" if detail else ""
    return f"WARN: NVIDIA 翻译失败（返回空译文）：{safe}{suffix}"


def _log_nvidia_translate_error(url: str, detail: str = "") -> str:
    msg = _format_nvidia_translate_error(url, detail=detail)
    return log_warn("nvidia_translate", msg, min_interval_s=5.0)


def _parse_retry_after_s(v: str) -> float:
    s = str(v or "").strip()
    if not s:
        return 0.0
    try:
        return max(0.0, float(s))
    except Exception:
        return 0.0


def _extract_error_detail(obj) -> str:
    """
    Best-effort extraction for API error payloads (without leaking secrets).
    """
    if not isinstance(obj, dict):
        return ""
    err = obj.get("error")
    if isinstance(err, str) and err.strip():
        return err.strip()
    if isinstance(err, dict):
        msg = err.get("message") or err.get("detail") or err.get("error") or ""
        code = err.get("code") or err.get("status") or err.get("type") or ""
        parts = []
        if isinstance(code, (str, int)) and str(code).strip():
            parts.append(f"code={str(code).strip()}")
        if isinstance(msg, str) and msg.strip():
            parts.append(msg.strip())
        return " ".join(parts).strip()
    for k in ("message", "detail", "error_description"):
        v = obj.get(k)
        if isinstance(v, str) and v.strip():
            return v.strip()
    return ""


def _log_nvidia_model_fallback(from_model: str, to_model: str) -> None:
    msg = f"WARN: NVIDIA 模型不可用，已自动回退：{from_model} -> {to_model}"
    log_warn("nvidia_translate", msg, min_interval_s=30.0)


def _log_nvidia_output_fallback(from_model: str, to_model: str) -> None:
    msg = f"WARN: NVIDIA 输出疑似未翻译，已自动回退：{from_model} -> {to_model}"
    log_warn("nvidia_translate", msg, min_interval_s=30.0)


def _log_nvidia_timeout_fallback(from_model: str, to_model: str, timeout_s: float) -> None:
    try:
        ts = float(timeout_s or 0.0)
    except Exception:
        ts = 0.0
    msg = f"WARN: NVIDIA 请求超时，已自动回退：{from_model} -> {to_model}（timeout_s={ts}）"
    log_warn("nvidia_translate", msg, min_interval_s=30.0)


def _log_nvidia_format_fallback(from_model: str, to_model: str) -> None:
    msg = f"WARN: NVIDIA 输出未保留 Markdown 标记，已自动回退：{from_model} -> {to_model}"
    log_warn("nvidia_translate", msg, min_interval_s=30.0)


def _looks_like_untranslated_output(out: str) -> bool:
    """
    Best-effort heuristic: detect responses that are clearly not a Chinese translation.

    Common failure modes:
    - model echoes/rewrites instructions in English (especially on some translate-* models)
    - model outputs a meta prompt instead of translation
    """
    s = str(out or "").strip()
    if not s:
        return False
    low = s.lower()
    for p in _UNTRANSLATED_PATTERNS:
        if p in low:
            return True
    # CJK ratio heuristic: if the output is overwhelmingly ASCII letters, it's likely not translated.
    try:
        cjk = sum(1 for ch in s if "\u4e00" <= ch <= "\u9fff")
        ascii_alpha = sum(1 for ch in s if ("A" <= ch <= "Z") or ("a" <= ch <= "z"))
    except Exception:
        return False
    if cjk < 8 and ascii_alpha >= 80:
        return True
    return False


def _has_md_heading(text: str) -> bool:
    """
    Detect Markdown headings outside fenced code blocks.
    """
    try:
        lines = str(text or "").splitlines()
    except Exception:
        return False
    in_code = False
    for raw in lines:
        ln = str(raw or "")
        if _MD_FENCE_RE.match(ln.strip()):
            in_code = not in_code
            continue
        if in_code:
            continue
        if _MD_HEADING_RE.match(ln):
            return True
    return False


def _has_md_fence(text: str) -> bool:
    return "```" in str(text or "")


def _violates_markdown_preservation(src_text: str, out_text: str) -> bool:
    """
    Best-effort quality gate for "preserve Markdown markers" requirements.

    - If input contains Markdown headings, output should still contain headings.
    - If input contains fenced code blocks, output should still contain fences.

    Note: skip batch prompts because they use marker protocols instead of normal Markdown.
    """
    if _looks_like_translate_batch_prompt(src_text):
        return False
    if not str(src_text or "").strip() or not str(out_text or "").strip():
        return False
    if _has_md_heading(src_text) and (not _has_md_heading(out_text)):
        return True
    if _has_md_fence(src_text) and (not _has_md_fence(out_text)):
        return True
    return False


def _extract_context_limit_hint(raw: bytes) -> tuple:
    """
    Try to extract a (max_context_tokens, message_tokens) hint from a 400 error payload.

    The NVIDIA integrate endpoint often uses an OpenAI-style error string, e.g.:
      \"This model's maximum context length is 4096 tokens. However, you requested 8224 tokens (32 in the messages, 8192 in the completion).\"
    """
    try:
        s = (raw or b"").decode("utf-8", errors="replace")
    except Exception:
        s = ""
    if not s.strip():
        return (0, 0)
    try:
        obj = json.loads(s)
        if isinstance(obj, dict):
            v = obj.get("error")
            if isinstance(v, str) and v.strip():
                s = v.strip()
            elif isinstance(v, dict):
                msg = v.get("message") or v.get("detail") or ""
                if isinstance(msg, str) and msg.strip():
                    s = msg.strip()
    except Exception:
        pass
    m = _CTX_LIMIT_RE.search(s)
    if not m:
        return (0, 0)
    try:
        max_ctx = int(m.group(1) or 0)
    except Exception:
        max_ctx = 0
    try:
        msg_tokens = int(m.group(2) or 0)
    except Exception:
        msg_tokens = 0
    return (max_ctx, msg_tokens)


def _log_nvidia_max_tokens_clamp(model: str, from_mt: int, to_mt: int, max_ctx: int) -> None:
    if to_mt <= 0 or from_mt <= 0 or to_mt >= from_mt:
        return
    msg = f"WARN: NVIDIA max_tokens 超出上下文，已自动降低：{from_mt} -> {to_mt}（model={model} max_ctx={max_ctx}）"
    log_warn("nvidia_translate", msg, min_interval_s=15.0)


def _recommended_timeout_s(text: str, model: str) -> float:
    """
    Heuristic timeout recommendations.

    Rationale:
    - Larger models and longer prompts often exceed 12s, leading to empty translations.
    - This keeps short requests responsive while reducing "timeout_s=12" failures for long texts.
    """
    try:
        tlen = len(str(text or ""))
    except Exception:
        tlen = 0
    m = str(model or "").strip().lower()
    if any(x in m for x in ("70b", "80b", "405b")):
        return 90.0
    if tlen >= 8000:
        return 120.0
    if tlen >= 2500:
        return 60.0
    if tlen >= 800:
        return 30.0
    return 12.0
