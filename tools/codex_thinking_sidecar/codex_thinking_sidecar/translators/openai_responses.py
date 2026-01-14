import json
import os
import hashlib
import urllib.error
import urllib.request
from collections import OrderedDict
from dataclasses import dataclass, field
from socket import timeout as _SocketTimeout

from .utils import compose_auth_value, log_warn, normalize_url, sanitize_url


def _model_supports_reasoning(model: str) -> bool:
    m = (model or "").strip().lower()
    if m.startswith("gpt-5"):
        return True
    # o-series reasoning models (o1/o3/o4-mini etc)
    if m.startswith("o"):
        return True
    return False


def _build_zh_translation_prompt(text: str) -> str:
    """
    Build a robust translation prompt without relying on system instructions.

    Notes:
    - Some proxies may override system prompts (e.g. Codex gateways). We keep the whole
      instruction in the user message to be more portable.
    """
    sentinel_a = "<<<SIDE_CAR_TEXT>>>"
    sentinel_b = "<<<END_SIDE_CAR_TEXT>>>"
    # Keep this prompt short to reduce token cost.
    return (
        "把下面内容翻译成【简体中文】，只输出译文。\n"
        "保留原有 Markdown/换行；代码块/命令/路径/变量名/JSON 原样不翻译；专有名词（API/HTTP/JSON/Codex/Sidecar 等）原样保留；原文中文为主则原样返回。\n\n"
        f"{sentinel_a}\n{text}\n{sentinel_b}\n"
    )


def _extract_openai_responses_text(obj) -> str:
    """
    Best-effort extraction for OpenAI Responses API (and compatible gateways).
    """
    if not isinstance(obj, dict):
        return ""
    v = obj.get("output_text")
    if isinstance(v, str) and v.strip():
        return v
    out = obj.get("output")
    if isinstance(out, list):
        for item in out:
            if not isinstance(item, dict):
                continue
            # Common shape: {"type":"message","role":"assistant","content":[{"type":"output_text","text":"..."}]}
            content = item.get("content")
            if isinstance(content, list):
                for part in content:
                    if not isinstance(part, dict):
                        continue
                    ptype = str(part.get("type") or "").strip()
                    if ptype in ("output_text", "text"):
                        txt = part.get("text")
                        if isinstance(txt, str) and txt.strip():
                            return txt
                    if isinstance(part.get("text"), str) and str(part.get("text") or "").strip():
                        return str(part.get("text") or "")
            # Fallbacks (gateways)
            t = item.get("text")
            if isinstance(t, str) and t.strip():
                return t
    # ChatCompletions-like fallback: {"choices":[{"message":{"content":"..."}}]}
    choices = obj.get("choices")
    if isinstance(choices, list) and choices:
        first = choices[0]
        if isinstance(first, dict):
            msg = first.get("message")
            if isinstance(msg, dict):
                c = msg.get("content")
                if isinstance(c, str) and c.strip():
                    return c
            c = first.get("text")
            if isinstance(c, str) and c.strip():
                return c
    return ""


def _extract_openai_responses_text_from_sse(raw: bytes) -> str:
    """
    Some gateways may return Responses streaming (text/event-stream) even when `stream:false`.

    We parse SSE `data:` lines (each should be a JSON object) and try to reconstruct
    `output_text` from:
      - response.output_text.delta / delta
      - response.output_text.done / text
      - response.completed / response (final object)
    """
    try:
        text = raw.decode("utf-8", errors="replace")
    except Exception:
        return ""

    deltas = []
    final_text = ""
    last_response = None

    for ln in text.splitlines():
        s = ln.strip()
        if not s:
            continue
        if not s.startswith("data:"):
            continue
        payload = s[len("data:") :].strip()
        if not payload or payload == "[DONE]":
            continue
        try:
            obj = json.loads(payload)
        except Exception:
            continue
        if not isinstance(obj, dict):
            continue

        # Some servers wrap the response object under `response`.
        resp_obj = obj.get("response") if isinstance(obj.get("response"), dict) else None
        if resp_obj is not None:
            last_response = resp_obj

        typ = str(obj.get("type") or "").strip()
        if typ.endswith("output_text.delta"):
            d = obj.get("delta")
            if isinstance(d, str) and d:
                deltas.append(d)
                continue
        if typ.endswith("output_text.done"):
            t = obj.get("text")
            if isinstance(t, str) and t.strip():
                final_text = t.strip()
                continue
        if typ.endswith("completed") and isinstance(resp_obj, dict):
            # Prefer extracting from final response object.
            ft = _extract_openai_responses_text(resp_obj)
            if isinstance(ft, str) and ft.strip():
                final_text = ft.strip()
                continue

    if final_text:
        return final_text
    if deltas:
        return "".join(deltas).strip()
    if isinstance(last_response, dict):
        ft = _extract_openai_responses_text(last_response)
        if isinstance(ft, str) and ft.strip():
            return ft.strip()
    return ""


def _format_openai_translate_error(url: str, auth_token: str, detail: str = "") -> str:
    safe = sanitize_url(url, auth_token)
    suffix = f" ({detail})" if detail else ""
    return f"WARN: GPT 翻译失败（返回空译文）：{safe}{suffix}"


def _log_openai_translate_error(url: str, auth_token: str, detail: str = "") -> str:
    msg = _format_openai_translate_error(url, auth_token, detail=detail)
    return log_warn("openai_translate", msg, min_interval_s=5.0)


@dataclass
class OpenAIResponsesTranslator:
    """
    OpenAI Responses API compatible translator.

    Typical proxy base url:
      - https://www.right.codes/codex/v1
    (sidecar will POST to {base_url}/responses)
    """

    base_url: str
    model: str = ""
    timeout_s: float = 12.0
    auth_env: str = ""
    api_key: str = ""
    auth_header: str = "Authorization"
    auth_prefix: str = "Bearer "
    reasoning_effort: str = ""
    last_error: str = ""
    cache_size: int = 64
    _cache: "OrderedDict[str, str]" = field(default_factory=OrderedDict, init=False, repr=False)

    def translate(self, text: str) -> str:
        if not text or not self.base_url:
            return ""

        ck = ""
        try:
            ck = hashlib.sha1(text.encode("utf-8")).hexdigest()
        except Exception:
            ck = ""
        if ck:
            hit = self._cache.get(ck)
            if isinstance(hit, str) and hit.strip():
                # refresh LRU
                try:
                    self._cache.pop(ck, None)
                    self._cache[ck] = hit
                except Exception:
                    pass
                return hit

        base = normalize_url(self.base_url).rstrip("/")
        endpoint = base if base.endswith("/responses") else (base + "/responses")

        token = (self.api_key or "").strip()
        if not token and self.auth_env:
            token = (os.environ.get(self.auth_env) or "").strip()
        if not token:
            self.last_error = _log_openai_translate_error(endpoint, auth_token="", detail="missing_api_key")
            return ""

        prompt = _build_zh_translation_prompt(text)
        payload = {
            "model": (self.model or "").strip() or "gpt-4o-mini",
            "input": [
                {
                    "type": "message",
                    "role": "user",
                    "content": [
                        {"type": "input_text", "text": prompt},
                    ],
                }
            ],
            "stream": False,
        }
        effort = (self.reasoning_effort or "").strip()
        if effort and _model_supports_reasoning(payload["model"]):
            payload["reasoning"] = {"effort": effort}

        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        req = urllib.request.Request(endpoint, data=data, method="POST")
        req.add_header("Content-Type", "application/json; charset=utf-8")
        # Prefer a single JSON response when gateways support content negotiation.
        req.add_header("Accept", "application/json")

        # Auth header compatible with common gateways:
        # - Authorization: Bearer {key}
        # - x-api-key: {key}
        ah = (self.auth_header or "Authorization").strip()
        if ah.lower() == "x-api-key":
            req.add_header("x-api-key", token)
        else:
            req.add_header(ah, compose_auth_value(self.auth_prefix, token))

        try:
            with urllib.request.urlopen(req, timeout=self.timeout_s) as resp:
                raw = resp.read()
                ctype = str(resp.headers.get("Content-Type") or "")
            try:
                obj = json.loads(raw.decode("utf-8", errors="replace"))
            except ValueError:
                # Some gateways may return SSE even when `stream:false`.
                if "text/event-stream" in (ctype or "").lower() or raw.lstrip().startswith(b"event:") or b"\ndata:" in raw:
                    out = _extract_openai_responses_text_from_sse(raw)
                    if isinstance(out, str) and out.strip():
                        res = out.strip()
                        if ck:
                            try:
                                self._cache[ck] = res
                                while len(self._cache) > int(self.cache_size or 0):
                                    self._cache.popitem(last=False)
                            except Exception:
                                pass
                        return res
                    self.last_error = _log_openai_translate_error(endpoint, auth_token=token, detail="sse_no_output_text")
                    return ""

                # If server returns plain text (non-JSON), try to use it.
                try:
                    if "application/json" not in (ctype or "").lower():
                        txt = raw.decode("utf-8", errors="replace").strip()
                        if txt and not txt.lstrip().startswith("<"):
                            return txt
                except Exception:
                    pass
                self.last_error = _log_openai_translate_error(endpoint, auth_token=token)
                return ""

            # Error shapes:
            if isinstance(obj, dict):
                if isinstance(obj.get("error"), str) and str(obj.get("error") or "").strip():
                    self.last_error = _log_openai_translate_error(
                        endpoint,
                        auth_token=token,
                        detail=str(obj.get("error"))[:200],
                    )
                    return ""
                if isinstance(obj.get("error"), dict):
                    e = obj.get("error") or {}
                    msg = ""
                    try:
                        for k in ("message", "error", "detail", "type"):
                            v = e.get(k)
                            if isinstance(v, str) and v.strip():
                                msg = v
                                break
                    except Exception:
                        msg = ""
                    self.last_error = _log_openai_translate_error(
                        endpoint,
                        auth_token=token,
                        detail=msg[:200] if msg else "api_error",
                    )
                    return ""

            out = _extract_openai_responses_text(obj)
            if isinstance(out, str) and out.strip():
                res = out.strip()
                if ck:
                    try:
                        self._cache[ck] = res
                        while len(self._cache) > int(self.cache_size or 0):
                            self._cache.popitem(last=False)
                    except Exception:
                        pass
                return res
            self.last_error = _log_openai_translate_error(endpoint, auth_token=token, detail="no_output_text")
            return ""
        except urllib.error.HTTPError as e:
            detail = f"http_status={getattr(e, 'code', '')}"
            try:
                body = (e.read() or b"")[:240]
                if body and not body.lstrip().startswith(b"<"):
                    detail += f" body={body.decode('utf-8', errors='replace')}"
            except Exception:
                pass
            self.last_error = _log_openai_translate_error(endpoint, auth_token=token, detail=detail)
            return ""
        except (TimeoutError, _SocketTimeout):
            self.last_error = _log_openai_translate_error(endpoint, auth_token=token, detail=f"timeout_s={self.timeout_s}")
            return ""
        except urllib.error.URLError as e:
            reason = getattr(e, "reason", None)
            rname = type(reason).__name__ if reason is not None else "URLError"
            self.last_error = _log_openai_translate_error(endpoint, auth_token=token, detail=f"url_error={rname}")
            return ""
        except Exception as e:
            self.last_error = _log_openai_translate_error(endpoint, auth_token=token, detail=f"error={type(e).__name__}")
            return ""
