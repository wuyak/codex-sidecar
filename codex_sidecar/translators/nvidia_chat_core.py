import json
import os
import time
import hashlib
import threading
import urllib.error
import urllib.request
from collections import OrderedDict
from dataclasses import dataclass, field
from socket import timeout as _SocketTimeout

from .batch_prompt import looks_like_translate_batch_prompt as _looks_like_translate_batch_prompt
from .nvidia_chat_helpers import (
    _extract_chat_completions_text,
    _extract_context_limit_hint,
    _extract_error_detail,
    _log_nvidia_format_fallback,
    _log_nvidia_max_tokens_clamp,
    _log_nvidia_model_fallback,
    _log_nvidia_output_fallback,
    _log_nvidia_timeout_fallback,
    _log_nvidia_translate_error,
    _looks_like_untranslated_output,
    _parse_retry_after_s,
    _recommended_timeout_s,
    _violates_markdown_preservation,
)
from .utils import compose_auth_value, normalize_url


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
    allow_fallback: bool = False
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
