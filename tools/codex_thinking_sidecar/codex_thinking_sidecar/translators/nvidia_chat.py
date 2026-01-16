import json
import os
import time
import hashlib
import threading
import urllib.error
import urllib.request
import re
from collections import OrderedDict
from dataclasses import dataclass, field
from socket import timeout as _SocketTimeout

from .utils import compose_auth_value, log_warn, normalize_url, sanitize_url


NVIDIA_CHAT_MODELS = (
    "moonshotai/kimi-k2-instruct",
    "mistralai/ministral-14b-instruct-2512",
    "mistralai/mistral-7b-instruct-v0.3",
    "google/gemma-3-1b-it",
)
DEFAULT_NVIDIA_CHAT_MODEL = NVIDIA_CHAT_MODELS[0]
# Prompt sentinels used to delimit the input text (models may echo them back).
SIDECAR_PROMPT_SENTINEL_A = "<<<SIDE_CAR_TEXT>>>"
SIDECAR_PROMPT_SENTINEL_B = "<<<END_SIDE_CAR_TEXT>>>"

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


def _looks_like_translate_batch_prompt(text: str) -> bool:
    s = str(text or "")
    return (
        "<<<SIDECAR_TRANSLATE_BATCH_V1>>>" in s
        and "<<<SIDECAR_ITEM:" in s
        and "<<<SIDECAR_END>>>" in s
    )


def _build_zh_translation_prompt(text: str) -> str:
    return (
        "把下面内容翻译成【简体中文】，只输出译文。\n"
        "格式要求：逐行翻译并保持原有行序/分段/空行；不要合并或拆分段落；不要新增列表/标题/解释；保留原有 Markdown 标记（如 `#` 标题前缀、列表符号、缩进、``` 围栏）。\n"
        "标题规则：对以 `#` 开头的标题行，必须保留 `#` 前缀与后续空格，并翻译其后的标题文字（不要删除 `#`）。\n"
        "内容要求：中文原样保留、仅翻译英文；代码块/命令/路径/变量名/JSON 原样不翻译；专有名词（API/HTTP/JSON/Codex/Sidecar/NVIDIA 等）原样保留；原文中文为主则原样返回。\n\n"
        f"{SIDECAR_PROMPT_SENTINEL_A}\n{text}\n{SIDECAR_PROMPT_SENTINEL_B}\n"
    )


def _strip_prompt_sentinels(text: str) -> str:
    """
    Some models echo the prompt sentinels back. Strip them to avoid polluting UI output.
    """
    s = str(text or "")
    if not s.strip():
        return ""
    a = SIDECAR_PROMPT_SENTINEL_A
    b = SIDECAR_PROMPT_SENTINEL_B
    if a in s and b in s:
        try:
            mid = s.split(a, 1)[1]
            mid = mid.split(b, 1)[0]
            return mid.strip()
        except Exception:
            pass
    # Line-based fallback (handles partial/inline cases).
    lines = []
    for ln in s.splitlines():
        t = ln.strip()
        if t == a or t == b:
            continue
        lines.append(ln)
    return "\n".join(lines).strip()


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


@dataclass
class NvidiaChatTranslator:
    """
    NVIDIA NIM (build.nvidia.com) Chat Completions compatible translator.

    Default base URL:
      - https://integrate.api.nvidia.com/v1

    Endpoint used:
      - {base_url}/chat/completions
    """

    base_url: str
    model: str = DEFAULT_NVIDIA_CHAT_MODEL
    timeout_s: float = 60.0
    auth_env: str = "NVIDIA_API_KEY"
    api_key: str = ""
    rpm: int = 0
    max_tokens: int = 8192
    max_retries: int = 3
    allow_fallback: bool = True
    last_error: str = ""
    cache_size: int = 64
    _cache: "OrderedDict[str, str]" = field(default_factory=OrderedDict, init=False, repr=False)
    _lock: threading.Lock = field(default_factory=threading.Lock, init=False, repr=False)
    _next_allowed_ts: float = field(default=0.0, init=False, repr=False)
    _resolved_model: str = field(default="", init=False, repr=False)

    def _endpoint(self) -> str:
        base = normalize_url(self.base_url).rstrip("/")
        if base.endswith("/chat/completions"):
            return base
        return base + "/chat/completions"

    def _throttle(self) -> None:
        try:
            rpm = int(self.rpm or 0)
        except Exception:
            rpm = 0
        if rpm <= 0:
            return
        min_interval = 60.0 / float(max(1, rpm))
        sleep_s = 0.0
        with self._lock:
            now = time.time()
            if self._next_allowed_ts and now < self._next_allowed_ts:
                sleep_s = float(self._next_allowed_ts - now)
            self._next_allowed_ts = max(self._next_allowed_ts, now) + min_interval
        if sleep_s > 0:
            # Keep it deterministic; the translation pump is already a single worker thread.
            time.sleep(sleep_s)

    def _cache_get(self, text: str) -> str:
        try:
            ck = hashlib.sha1(text.encode("utf-8")).hexdigest()
        except Exception:
            return ""
        hit = self._cache.get(ck)
        if isinstance(hit, str) and hit.strip():
            try:
                self._cache.pop(ck, None)
                self._cache[ck] = hit
            except Exception:
                pass
            return hit
        return ""

    def _cache_put(self, text: str, out: str) -> None:
        if not isinstance(out, str) or not out.strip():
            return
        try:
            ck = hashlib.sha1(text.encode("utf-8")).hexdigest()
        except Exception:
            return
        try:
            self._cache.pop(ck, None)
            self._cache[ck] = out
            while len(self._cache) > int(self.cache_size or 64):
                self._cache.popitem(last=False)
        except Exception:
            return

    def translate(self, text: str) -> str:
        if not text or not self.base_url:
            return ""

        hit = self._cache_get(text)
        if hit:
            return hit

        endpoint = self._endpoint()

        token = (self.api_key or "").strip()
        if not token and self.auth_env:
            token = (os.environ.get(self.auth_env) or "").strip()
        if not token:
            self.last_error = _log_nvidia_translate_error(endpoint, detail="missing_api_key")
            return ""

        # Batch prompts already include strict marker-preservation rules; do not re-wrap.
        prompt = text if _looks_like_translate_batch_prompt(text) else _build_zh_translation_prompt(text)

        base_payload = {
            "temperature": 0,
            "messages": [
                {"role": "user", "content": prompt},
            ],
            "stream": False,
        }
        try:
            mt = int(self.max_tokens or 0)
        except Exception:
            mt = 0
        if mt > 0:
            base_payload["max_tokens"] = mt
        model = (self._resolved_model or (self.model or "")).strip() or DEFAULT_NVIDIA_CHAT_MODEL
        if bool(self.allow_fallback):
            model_candidates = [model] + [m for m in NVIDIA_CHAT_MODELS if m and m != model]
        else:
            model_candidates = [model]
        tried_models = {model}

        def _next_fallback_model() -> str:
            nonlocal model
            for cand in model_candidates:
                if not cand:
                    continue
                if cand in tried_models:
                    continue
                tried_models.add(cand)
                self._resolved_model = cand
                model = cand
                return cand
            return ""
        # Some long prompts/models require longer than the configured default.
        try:
            base_timeout_s = float(self.timeout_s or 60.0)
        except Exception:
            base_timeout_s = 60.0
        effective_timeout_s = max(base_timeout_s, float(_recommended_timeout_s(text, model)))

        def _make_req(payload_bytes: bytes) -> urllib.request.Request:
            req = urllib.request.Request(endpoint, data=payload_bytes, method="POST")
            # NVIDIA integrate endpoint expects exactly "application/json" (no charset).
            req.add_header("Content-Type", "application/json")
            req.add_header("Authorization", compose_auth_value("Bearer ", token))
            return req

        max_attempts = 1 + max(0, int(self.max_retries or 0))
        backoff_s = 1.0
        clamp_tried = False

        for attempt in range(max_attempts):
            # Global rate limit guard (e.g. 40 RPM).
            self._throttle()

            try:
                try:
                    data = json.dumps({**base_payload, "model": model}, ensure_ascii=False).encode("utf-8")
                except Exception:
                    self.last_error = _log_nvidia_translate_error(endpoint, detail="json_encode_failed")
                    return ""

                req = _make_req(data)
                with urllib.request.urlopen(req, timeout=float(effective_timeout_s)) as resp:
                    raw = resp.read()
                    ctype = str(resp.headers.get("Content-Type") or "")
                try:
                    obj = json.loads(raw.decode("utf-8", errors="replace"))
                except ValueError:
                    # If server returns plain text (non-JSON), try to use it.
                    try:
                        if "application/json" not in (ctype or "").lower():
                            txt = raw.decode("utf-8", errors="replace").strip()
                            if txt and not txt.lstrip().startswith("<"):
                                self._cache_put(text, txt)
                                return txt
                    except Exception:
                        pass
                    self.last_error = _log_nvidia_translate_error(endpoint, detail="invalid_json")
                    return ""

                out = _strip_prompt_sentinels(_extract_chat_completions_text(obj)).strip()
                if out:
                    if _looks_like_untranslated_output(out):
                        # If the configured model is callable but doesn't translate, try a better fallback.
                        if bool(self.allow_fallback) and attempt < (max_attempts - 1):
                            prev = model
                            fb = _next_fallback_model()
                            if fb:
                                _log_nvidia_output_fallback(prev, fb)
                                continue
                        self.last_error = _log_nvidia_translate_error(endpoint, detail="untranslated_output")
                        return ""
                    if _violates_markdown_preservation(text, out):
                        if bool(self.allow_fallback) and attempt < (max_attempts - 1):
                            prev = model
                            fb = _next_fallback_model()
                            if fb:
                                _log_nvidia_format_fallback(prev, fb)
                                continue
                        self.last_error = _log_nvidia_translate_error(endpoint, detail="markdown_format_violation")
                        return ""
                    self._cache_put(text, out)
                    return out
                err_detail = _extract_error_detail(obj)
                if err_detail:
                    self.last_error = _log_nvidia_translate_error(endpoint, detail=err_detail[:200])
                else:
                    self.last_error = _log_nvidia_translate_error(endpoint, detail="empty_output")
                return ""

            except urllib.error.HTTPError as e:
                code = getattr(e, "code", None)
                body = b""
                try:
                    body = e.read() or b""
                except Exception:
                    body = b""
                if code == 429 and attempt < (max_attempts - 1):
                    retry_after = _parse_retry_after_s(str(getattr(e, "headers", {}).get("Retry-After", "") or ""))
                    sleep_s = retry_after if retry_after > 0 else min(backoff_s, 30.0)
                    # Small deterministic cushion to reduce immediate re-hit.
                    time.sleep(float(sleep_s) + 0.2)
                    backoff_s = min(backoff_s * 2.0, 30.0)
                    continue

                # NVIDIA integrate endpoint often returns 404 for:
                # - missing/invalid auth, or
                # - unknown model (common when users copy from outdated docs).
                if code == 404 and bool(self.allow_fallback) and attempt < (max_attempts - 1):
                    prev = model
                    fb = _next_fallback_model()
                    if fb:
                        _log_nvidia_model_fallback(prev, fb)
                        continue

                # User-specified max_tokens may exceed the selected model's context window.
                # Clamp and retry once to avoid returning an empty translation.
                if code == 400 and (not clamp_tried) and attempt < (max_attempts - 1):
                    max_ctx, msg_tokens = _extract_context_limit_hint(body)
                    try:
                        cur_mt = int(base_payload.get("max_tokens") or 0)
                    except Exception:
                        cur_mt = 0
                    if max_ctx > 0 and msg_tokens > 0 and cur_mt > 0:
                        # Keep a small safety margin to avoid off-by-one/tokenizer variance.
                        safe_mt = max(0, int(max_ctx) - int(msg_tokens) - 32)
                        if safe_mt > 0 and safe_mt < cur_mt:
                            clamp_tried = True
                            base_payload["max_tokens"] = safe_mt
                            _log_nvidia_max_tokens_clamp(model, cur_mt, safe_mt, max_ctx)
                            continue

                detail = f"http_status={code} model={model}"
                try:
                    head = (body or b"")[:200]
                    if head and not head.lstrip().startswith(b"<"):
                        detail += f" body={head.decode('utf-8', errors='replace')}"
                except Exception:
                    pass
                self.last_error = _log_nvidia_translate_error(endpoint, detail=detail)
                return ""
            except (TimeoutError, _SocketTimeout):
                if attempt < (max_attempts - 1):
                    if bool(self.allow_fallback):
                        prev = model
                        fb = _next_fallback_model()
                        if fb:
                            _log_nvidia_timeout_fallback(prev, fb, effective_timeout_s)
                            continue
                    time.sleep(min(backoff_s, 30.0))
                    backoff_s = min(backoff_s * 2.0, 30.0)
                    continue
                self.last_error = _log_nvidia_translate_error(endpoint, detail=f"timeout_s={effective_timeout_s}")
                return ""
            except urllib.error.URLError as e:
                if attempt < (max_attempts - 1):
                    time.sleep(min(backoff_s, 30.0))
                    backoff_s = min(backoff_s * 2.0, 30.0)
                    continue
                reason = getattr(e, "reason", None)
                rname = type(reason).__name__ if reason is not None else "URLError"
                self.last_error = _log_nvidia_translate_error(endpoint, detail=f"url_error={rname}")
                return ""
            except Exception as e:
                self.last_error = _log_nvidia_translate_error(endpoint, detail=f"error={type(e).__name__}")
                return ""
        return ""
