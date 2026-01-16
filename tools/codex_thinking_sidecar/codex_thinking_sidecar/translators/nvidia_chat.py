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

from .utils import compose_auth_value, log_warn, normalize_url, sanitize_url


def _looks_like_translate_batch_prompt(text: str) -> bool:
    s = str(text or "")
    return (
        "<<<SIDECAR_TRANSLATE_BATCH_V1>>>" in s
        and "<<<SIDECAR_ITEM:" in s
        and "<<<SIDECAR_END>>>" in s
    )


def _build_zh_translation_prompt(text: str) -> str:
    sentinel_a = "<<<SIDE_CAR_TEXT>>>"
    sentinel_b = "<<<END_SIDE_CAR_TEXT>>>"
    return (
        "把下面内容翻译成【简体中文】，只输出译文。\n"
        "保留原有 Markdown/换行；代码块/命令/路径/变量名/JSON 原样不翻译；专有名词（API/HTTP/JSON/Codex/Sidecar/NVIDIA 等）原样保留；原文中文为主则原样返回。\n\n"
        f"{sentinel_a}\n{text}\n{sentinel_b}\n"
    )


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
    model: str = "nvidia/riva-translate-4b-instruct-v1_1"
    timeout_s: float = 12.0
    auth_env: str = "NVIDIA_API_KEY"
    api_key: str = ""
    rpm: int = 40
    max_retries: int = 3
    last_error: str = ""
    cache_size: int = 64
    _cache: "OrderedDict[str, str]" = field(default_factory=OrderedDict, init=False, repr=False)
    _lock: threading.Lock = field(default_factory=threading.Lock, init=False, repr=False)
    _next_allowed_ts: float = field(default=0.0, init=False, repr=False)

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

        payload = {
            "model": (self.model or "").strip() or "nvidia/riva-translate-4b-instruct-v1_1",
            "temperature": 0,
            "messages": [
                {"role": "user", "content": prompt},
            ],
            "stream": False,
        }

        try:
            data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        except Exception:
            self.last_error = _log_nvidia_translate_error(endpoint, detail="json_encode_failed")
            return ""

        def _make_req() -> urllib.request.Request:
            req = urllib.request.Request(endpoint, data=data, method="POST")
            req.add_header("Content-Type", "application/json; charset=utf-8")
            req.add_header("Authorization", compose_auth_value("Bearer ", token))
            return req

        max_attempts = 1 + max(0, int(self.max_retries or 0))
        backoff_s = 1.0

        for attempt in range(max_attempts):
            # Global rate limit guard (e.g. 40 RPM).
            self._throttle()

            try:
                req = _make_req()
                with urllib.request.urlopen(req, timeout=float(self.timeout_s or 12.0)) as resp:
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

                out = _extract_chat_completions_text(obj).strip()
                if out:
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
                if code == 429 and attempt < (max_attempts - 1):
                    retry_after = _parse_retry_after_s(str(getattr(e, "headers", {}).get("Retry-After", "") or ""))
                    sleep_s = retry_after if retry_after > 0 else min(backoff_s, 30.0)
                    # Small deterministic cushion to reduce immediate re-hit.
                    time.sleep(float(sleep_s) + 0.2)
                    backoff_s = min(backoff_s * 2.0, 30.0)
                    continue
                detail = f"http_status={code}"
                try:
                    body = (e.read() or b"")[:200]
                    if body and not body.lstrip().startswith(b"<"):
                        detail += f" body={body.decode('utf-8', errors='replace')}"
                except Exception:
                    pass
                self.last_error = _log_nvidia_translate_error(endpoint, detail=detail)
                return ""
            except (TimeoutError, _SocketTimeout):
                if attempt < (max_attempts - 1):
                    time.sleep(min(backoff_s, 30.0))
                    backoff_s = min(backoff_s * 2.0, 30.0)
                    continue
                self.last_error = _log_nvidia_translate_error(endpoint, detail=f"timeout_s={self.timeout_s}")
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
