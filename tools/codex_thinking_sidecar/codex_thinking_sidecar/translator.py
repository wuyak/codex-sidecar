import json
import os
import re
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
                _log_http_translate_error(url=url, auth_token=self.auth_token)
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
            _log_http_translate_error(url=url, auth_token=self.auth_token)
            return ""
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, ValueError):
            _log_http_translate_error(url=url, auth_token=self.auth_token)
            return ""
        except Exception:
            _log_http_translate_error(url=url, auth_token=self.auth_token)
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


def _log_http_translate_error(url: str, auth_token: str) -> None:
    global _LAST_HTTP_ERR_TS
    now = time.time()
    if now - _LAST_HTTP_ERR_TS < 5.0:
        return
    _LAST_HTTP_ERR_TS = now
    safe = _sanitize_url(url, auth_token)
    print(f"[sidecar] WARN: HTTP 翻译失败（返回空译文）：{safe}", file=sys.stderr)
