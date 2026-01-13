import json
import os
import sys
import time
import urllib.parse
import urllib.error
import urllib.request
from dataclasses import dataclass
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


@dataclass
class HttpTranslator:
    url: str
    timeout_s: float = 3.0
    auth_env: str = ""
    auth_token: str = ""
    auth_header: str = "Authorization"
    auth_prefix: str = "Bearer "

    def translate(self, text: str) -> str:
        if not text or not self.url:
            return ""
        url = self.url
        if self.auth_token and "{token}" in url:
            url = url.replace("{token}", self.auth_token)
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
        req = urllib.request.Request(url, data=data, method="POST")
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
                _log_http_translate_error(url=url, auth_token=self.auth_token)
                return ""

            # Best-effort extraction across common shapes.
            if isinstance(obj, dict):
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
            _log_http_translate_error(url=url, auth_token=self.auth_token)
            return ""
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, ValueError):
            _log_http_translate_error(url=url, auth_token=self.auth_token)
            return ""
        except Exception:
            _log_http_translate_error(url=url, auth_token=self.auth_token)
            return ""


_LAST_HTTP_ERR_TS = 0.0


def _sanitize_url(url: str, auth_token: str) -> str:
    try:
        u = urllib.parse.urlsplit(url)
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


def _log_http_translate_error(url: str, auth_token: str) -> None:
    global _LAST_HTTP_ERR_TS
    now = time.time()
    if now - _LAST_HTTP_ERR_TS < 5.0:
        return
    _LAST_HTTP_ERR_TS = now
    safe = _sanitize_url(url, auth_token)
    print(f"[sidecar] WARN: HTTP 翻译失败（返回空译文）：{safe}", file=sys.stderr)
