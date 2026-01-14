import json
import os
import re
import sys
import time
import hashlib
import urllib.parse
import urllib.error
import urllib.request
from collections import OrderedDict
from socket import timeout as _SocketTimeout
from dataclasses import dataclass, field
from typing import Protocol


class Translator(Protocol):
    def translate(self, text: str) -> str:
        ...


class StubTranslator:
    """
    占位翻译器：不调用任何外部 API。

    目的：先把“监听 → 提取 → 推送/展示”的链路跑通，后续再替换为真实翻译实现。
    """

    def translate(self, text: str) -> str:
        if not text:
            return ""
        # 这里用可辨识的占位，便于你确认链路是否工作。
        return "【中文占位】\n" + text


class NoneTranslator:
    def translate(self, text: str) -> str:
        return ""


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
    return (
        "你是一个高质量的翻译引擎。请把下面内容翻译成【简体中文】。\n\n"
        "要求：\n"
        "- 只输出译文，不要添加任何解释/前缀/引号。\n"
        "- 尽量保持原有 Markdown 结构（标题/列表/空行/缩进）。\n"
        "- 代码块、命令行、路径、变量名、JSON 等“看起来像代码”的片段保持原样，不要翻译。\n"
        "- 专有名词如 API/HTTP/JSON/Codex/Sidecar 保持原样。\n"
        "- 如果原文已经是中文为主，则原样返回。\n\n"
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


def _format_openai_translate_error(url: str, auth_token: str, detail: str = "") -> str:
    safe = _sanitize_url(url, auth_token)
    suffix = f" ({detail})" if detail else ""
    return f"WARN: GPT 翻译失败（返回空译文）：{safe}{suffix}"


def _log_openai_translate_error(url: str, auth_token: str, detail: str = "") -> str:
    global _LAST_HTTP_ERR_TS
    msg = _format_openai_translate_error(url, auth_token, detail=detail)
    now = time.time()
    if now - _LAST_HTTP_ERR_TS < 5.0:
        return msg
    _LAST_HTTP_ERR_TS = now
    print(f"[sidecar] {msg}", file=sys.stderr)
    return msg


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

        base = _normalize_url(self.base_url).rstrip("/")
        endpoint = base if base.endswith("/responses") else (base + "/responses")

        token = (self.api_key or "").strip()
        if not token and self.auth_env:
            token = (os.environ.get(self.auth_env) or "").strip()
        if not token:
            self.last_error = _log_openai_translate_error(endpoint, auth_token="", detail="missing_api_key")
            return ""

        prompt = _build_zh_translation_prompt(text)
        payload = {
            "model": (self.model or "").strip() or "gpt-4.1-mini",
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

        # Auth header compatible with common gateways:
        # - Authorization: Bearer {key}
        # - x-api-key: {key}
        ah = (self.auth_header or "Authorization").strip()
        if ah.lower() == "x-api-key":
            req.add_header("x-api-key", token)
        else:
            req.add_header(ah, f"{self.auth_prefix}{token}")

        try:
            with urllib.request.urlopen(req, timeout=self.timeout_s) as resp:
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
                            return txt
                except Exception:
                    pass
                self.last_error = _log_openai_translate_error(endpoint, auth_token=token)
                return ""

            # Error shapes:
            if isinstance(obj, dict):
                if isinstance(obj.get("error"), str) and str(obj.get("error") or "").strip():
                    self.last_error = _log_openai_translate_error(endpoint, auth_token=token, detail=str(obj.get("error"))[:200])
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
                    self.last_error = _log_openai_translate_error(endpoint, auth_token=token, detail=msg[:200] if msg else "api_error")
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


@dataclass
class HttpTranslator:
    url: str
    timeout_s: float = 3.0
    auth_env: str = ""
    auth_token: str = ""
    auth_header: str = "Authorization"
    auth_prefix: str = "Bearer "
    last_error: str = ""

    def translate(self, text: str) -> str:
        if not text or not self.url:
            return ""
        url = _normalize_url(self.url)
        if self.auth_token and "{token}" in url:
            url = url.replace("{token}", self.auth_token)
        url = _normalize_url(url)

        parsed = urllib.parse.urlsplit(url)
        base_url = urllib.parse.urlunsplit((parsed.scheme, parsed.netloc, parsed.path, "", ""))
        qs = urllib.parse.parse_qs(parsed.query or "")
        is_translate_json = parsed.path.endswith("/translate.json") or parsed.path.endswith("translate.json")

        if is_translate_json:
            # SiliconFlow translate.js compatible endpoint:
            # - POST application/x-www-form-urlencoded
            # - text is a JSON array string: text=["..."]
            # - returns: {"text":["..."], ...}
            to_lang = (qs.get("to") or ["chinese_simplified"])[0] or "chinese_simplified"
            from_lang = (qs.get("from") or ["auto"])[0] or "auto"
            form = {
                "to": to_lang,
                "text": json.dumps([text], ensure_ascii=False),
            }
            if from_lang:
                form["from"] = from_lang
            data = urllib.parse.urlencode(form).encode("utf-8")
            req = urllib.request.Request(base_url, data=data, method="POST")
            req.add_header("Content-Type", "application/x-www-form-urlencoded; charset=utf-8")
        else:
            # Many community translation endpoints (e.g., DeepLX) use different field names.
            # Send both variants for broader compatibility; servers can ignore unknown keys.
            payload = {
                "text": text,
                "source": "en",
                "target": "zh",
                "source_lang": "EN",
                "target_lang": "ZH",
            }
            data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            req = urllib.request.Request(base_url, data=data, method="POST")
            req.add_header("Content-Type", "application/json; charset=utf-8")

        token = (self.auth_token or "").strip()
        if not token and self.auth_env:
            token = (os.environ.get(self.auth_env) or "").strip()
        if token:
            req.add_header(self.auth_header, f"{self.auth_prefix}{token}")
        try:
            with urllib.request.urlopen(req, timeout=self.timeout_s) as resp:
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
                            return txt
                except Exception:
                    pass
                self.last_error = _log_http_translate_error(url=url, auth_token=self.auth_token)
                return ""

            # Best-effort extraction across common shapes.
            if isinstance(obj, dict):
                # translate.json: {"text":["..."]}
                tlist = obj.get("text")
                if isinstance(tlist, list) and tlist:
                    first = tlist[0]
                    if isinstance(first, str) and first.strip():
                        return first
                for k in ("text", "data", "result", "translation", "translated_text"):
                    v = obj.get(k)
                    if isinstance(v, str) and v.strip():
                        return v
                    if isinstance(v, dict):
                        for kk in ("text", "data", "result", "translation", "translated_text"):
                            vv = v.get(kk)
                            if isinstance(vv, str) and vv.strip():
                                return vv
                # DeepL-like shape: {"translations":[{"text":"..."}]}
                tr = obj.get("translations")
                if isinstance(tr, list) and tr:
                    first = tr[0]
                    if isinstance(first, dict):
                        t = first.get("text")
                        if isinstance(t, str) and t.strip():
                            return t
            # Provide best-effort error hints without leaking secrets.
            detail = ""
            try:
                if isinstance(obj, dict):
                    if isinstance(obj.get("message"), str) and obj.get("message"):
                        detail = str(obj.get("message"))[:160]
                    elif isinstance(obj.get("info"), str) and obj.get("info"):
                        detail = str(obj.get("info"))[:160]
                    elif isinstance(obj.get("error"), str) and obj.get("error"):
                        detail = str(obj.get("error"))[:160]
                    elif isinstance(obj.get("code"), int):
                        detail = f"code={obj.get('code')}"
            except Exception:
                detail = ""
            self.last_error = _log_http_translate_error(url=url, auth_token=self.auth_token, detail=detail)
            return ""
        except urllib.error.HTTPError as e:
            detail = f"http_status={getattr(e, 'code', '')}"
            try:
                body = (e.read() or b"")[:200]
                # avoid printing html pages
                if body and not body.lstrip().startswith(b"<"):
                    detail += f" body={body.decode('utf-8', errors='replace')}"
            except Exception:
                pass
            self.last_error = _log_http_translate_error(url=url, auth_token=self.auth_token, detail=detail)
            return ""
        except (TimeoutError, _SocketTimeout):
            self.last_error = _log_http_translate_error(
                url=url,
                auth_token=self.auth_token,
                detail=f"timeout_s={self.timeout_s}",
            )
            return ""
        except urllib.error.URLError as e:
            reason = getattr(e, "reason", None)
            rname = type(reason).__name__ if reason is not None else "URLError"
            self.last_error = _log_http_translate_error(
                url=url,
                auth_token=self.auth_token,
                detail=f"url_error={rname}",
            )
            return ""
        except Exception as e:
            self.last_error = _log_http_translate_error(
                url=url,
                auth_token=self.auth_token,
                detail=f"error={type(e).__name__}",
            )
            return ""


_LAST_HTTP_ERR_TS = 0.0


_URL_RE = re.compile(r"https?://", re.IGNORECASE)


def _normalize_url(url: str) -> str:
    """
    容错：用户可能从文档/聊天复制带前缀标点（例如 `：https://...` / `URL：https://...`）。
    这里截取第一个 http(s):// 之后的部分，避免 urllib 报 `unknown url type`。
    """
    u = (url or "").strip()
    m = _URL_RE.search(u)
    if m and m.start() > 0:
        u = u[m.start() :]
    return u


def _sanitize_url(url: str, auth_token: str) -> str:
    try:
        u = urllib.parse.urlsplit(_normalize_url(url))
        path = u.path or ""
        if auth_token and auth_token in path:
            path = path.replace(auth_token, "<token>")
        # also redact long path segments that look like tokens
        parts = path.split("/")
        redacted = []
        for p in parts:
            if len(p) >= 24 and all(c.isalnum() or c in "-_." for c in p):
                redacted.append("<seg>")
            else:
                redacted.append(p)
        path = "/".join(redacted)
        return urllib.parse.urlunsplit((u.scheme, u.netloc, path, "", ""))
    except Exception:
        return "<url>"

def _format_http_translate_error(url: str, auth_token: str, detail: str = "") -> str:
    safe = _sanitize_url(url, auth_token)
    suffix = f" ({detail})" if detail else ""
    return f"WARN: HTTP 翻译失败（返回空译文）：{safe}{suffix}"


def _log_http_translate_error(url: str, auth_token: str, detail: str = "") -> str:
    global _LAST_HTTP_ERR_TS
    msg = _format_http_translate_error(url, auth_token, detail=detail)
    now = time.time()
    if now - _LAST_HTTP_ERR_TS < 5.0:
        return msg
    _LAST_HTTP_ERR_TS = now
    print(f"[sidecar] {msg}", file=sys.stderr)
    return msg
