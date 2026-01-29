import re
import json
import os
import urllib.parse
import urllib.error
import urllib.request
from dataclasses import dataclass
from socket import timeout as _SocketTimeout
from typing import Dict, List, Tuple, Optional

from .utils import compose_auth_value, log_warn, normalize_url, sanitize_url


def _format_http_translate_error(url: str, auth_token: str, detail: str = "") -> str:
    safe = sanitize_url(url, auth_token)
    suffix = f" ({detail})" if detail else ""
    return f"WARN: HTTP 翻译失败（返回空译文）：{safe}{suffix}"


def _log_http_translate_error(url: str, auth_token: str, detail: str = "") -> str:
    msg = _format_http_translate_error(url, auth_token, detail=detail)
    return log_warn("http_translate", msg, min_interval_s=5.0)


_GOOGLE_PA_DEFAULT_KEY = "AIzaSyDLEeFI5OtFBwYBIoK_jj5m32rZK5CkCXA"
_GOOGLE_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36"
)

_SC_LINE_RE = re.compile(r"\[\[SC_L(\d{6})\]\]")
_SC_INLINE_CODE_RE = re.compile(r"`[^`\n]+`")


def _split_md_prefix(line: str) -> Tuple[str, str]:
    """
    Split a markdown-ish line into (prefix, body).

    Prefix includes:
    - leading indentation
    - common markdown structural markers (heading/list/blockquote)
    """
    if not line:
        return ("", "")
    i = 0
    n = len(line)
    while i < n and line[i] in (" ", "\t"):
        i += 1
    indent = line[:i]
    rest = line[i:]
    if not rest:
        return (indent, "")

    # Headings: "# " .. "###### "
    if rest.startswith("#"):
        j = 0
        while j < len(rest) and rest[j] == "#":
            j += 1
        if 1 <= j <= 6 and j < len(rest) and rest[j] == " ":
            return (indent + rest[: j + 1], rest[j + 1 :])

    # Blockquotes: "> " or ">> "
    if rest.startswith(">"):
        j = 0
        while j < len(rest) and rest[j] == ">":
            j += 1
        if j > 0 and j < len(rest) and rest[j] == " ":
            return (indent + rest[: j + 1], rest[j + 1 :])
        if j > 0:
            return (indent + rest[:j], rest[j:])

    # Unordered list: "- " / "* " / "• " / "◦ "
    if len(rest) >= 2 and rest[0] in ("-", "*", "•", "◦") and rest[1] == " ":
        return (indent + rest[:2], rest[2:])

    # Ordered list: "1. " / "1) "
    j = 0
    while j < len(rest) and rest[j].isdigit():
        j += 1
    if j > 0 and (j + 1) < len(rest) and rest[j] in (".", ")") and rest[j + 1] == " ":
        return (indent + rest[: j + 2], rest[j + 2 :])

    return (indent, rest)


def _protect_inline_md(body: str, *, placeholders: Dict[str, str], counters: Dict[str, int]) -> str:
    if not body:
        return ""

    def _repl_code(m) -> str:
        counters["ic"] = int(counters.get("ic", 0) or 0) + 1
        k = f"[[SC_IC{counters['ic']:04d}]]"
        placeholders[k] = m.group(0)
        return k

    out = _SC_INLINE_CODE_RE.sub(_repl_code, body)
    # Protect URLs with a small manual scanner to avoid brittle regex edge cases.
    # Keep any trailing punctuation (e.g. ")") outside the placeholder.
    i = 0
    chunks: List[str] = []
    while True:
        a = out.find("http://", i)
        b = out.find("https://", i)
        if a < 0:
            start = b
        elif b < 0:
            start = a
        else:
            start = a if a < b else b
        if start < 0:
            chunks.append(out[i:])
            break
        chunks.append(out[i:start])
        end = start
        while end < len(out) and not out[end].isspace():
            end += 1
        url = out[start:end]
        trimmed = url.rstrip(").,;:!?]}>\"'")
        suffix = url[len(trimmed) :]
        if trimmed:
            counters["url"] = int(counters.get("url", 0) or 0) + 1
            k = f"[[SC_URL{counters['url']:04d}]]"
            placeholders[k] = trimmed
            chunks.append(k + suffix)
        else:
            chunks.append(url)
        i = end
    out = "".join(chunks)
    return out


@dataclass
class _GoogleFreeMdCtx:
    lines: List[str]
    literal: List[bool]
    prefixes: List[str]
    bodies: List[str]
    placeholders: Dict[str, str]
    ends_with_newline: bool = False


def _googlefree_build_md_preserve_input(text: str) -> Tuple[str, _GoogleFreeMdCtx]:
    raw = str(text or "")
    ends_with_nl = raw.endswith("\n")
    lines = raw.splitlines()
    n = len(lines)
    literal = [False] * n

    # Fence code blocks (``` ... ```): keep all lines in the fence verbatim.
    in_code = False
    for i, ln in enumerate(lines):
        t = ln.lstrip()
        if t.startswith("```"):
            literal[i] = True
            in_code = not in_code
            continue
        if in_code:
            literal[i] = True

    # Preserve blank lines and "separator" lines (e.g., "────") verbatim.
    for i, ln in enumerate(lines):
        if literal[i]:
            continue
        s = ln.strip()
        if not s:
            literal[i] = True
            continue
        if not any(ch.isalnum() for ch in s):
            # Pure punctuation/box-drawing/markers: keep it stable.
            literal[i] = True

    placeholders: Dict[str, str] = {}
    counters: Dict[str, int] = {"ic": 0, "url": 0}
    prefixes: List[str] = [""] * n
    bodies: List[str] = [""] * n

    # Build protected per-line input with stable markers.
    tx_lines: List[str] = []
    for i, ln in enumerate(lines):
        idx = i + 1
        marker = f"[[SC_L{idx:06d}]]"
        if literal[i]:
            prefixes[i] = ""
            bodies[i] = ""
            tx_lines.append(marker)
            continue
        prefix, body = _split_md_prefix(ln)
        body2 = _protect_inline_md(body, placeholders=placeholders, counters=counters)
        prefixes[i] = prefix
        bodies[i] = body2
        if body2:
            tx_lines.append(marker + body2)
        else:
            tx_lines.append(marker)

    tx = "\n".join(tx_lines)
    if ends_with_nl:
        tx += "\n"
    return tx, _GoogleFreeMdCtx(
        lines=lines,
        literal=literal,
        prefixes=prefixes,
        bodies=bodies,
        placeholders=placeholders,
        ends_with_newline=ends_with_nl,
    )


def _googlefree_restore_md(translated: str, ctx: _GoogleFreeMdCtx) -> str:
    out_s = str(translated or "")
    found: Dict[int, str] = {}
    for ln in out_s.splitlines():
        m = _SC_LINE_RE.search(ln)
        if not m:
            continue
        try:
            idx = int(m.group(1))
        except Exception:
            continue
        found[idx] = ln[m.end() :]

    rebuilt: List[str] = []
    for i, orig_ln in enumerate(ctx.lines):
        idx = i + 1
        if ctx.literal[i]:
            rebuilt.append(orig_ln)
            continue
        body = found.get(idx)
        if body is None:
            body = ctx.bodies[i]
        body = str(body or "").lstrip()
        rebuilt.append(ctx.prefixes[i] + body)

    out = "\n".join(rebuilt)
    if ctx.ends_with_newline:
        out += "\n"

    # Restore protected inline chunks.
    for k, v in ctx.placeholders.items():
        if k and k in out:
            out = out.replace(k, v)
    return out


@dataclass
class HttpTranslator:
    url: str
    timeout_s: float = 3.0
    profile_name: str = ""
    auth_env: str = ""
    auth_token: str = ""
    auth_header: str = "Authorization"
    auth_prefix: str = "Bearer "
    last_error: str = ""

    def translate(self, text: str) -> str:
        if not text or not self.url:
            return ""
        want_google_md = str(self.profile_name or "").strip().lower() == "googlefree"
        url = normalize_url(self.url)
        if self.auth_token and "{token}" in url:
            url = url.replace("{token}", self.auth_token)
        url = normalize_url(url)

        parsed = urllib.parse.urlsplit(url)
        base_url = urllib.parse.urlunsplit((parsed.scheme, parsed.netloc, parsed.path, "", ""))
        qs = urllib.parse.parse_qs(parsed.query or "")
        is_translate_json = parsed.path.endswith("/translate.json") or parsed.path.endswith("translate.json")
        host = str(parsed.netloc or "").strip().lower()
        path = str(parsed.path or "").strip()
        is_google_pa = (host == "translate-pa.googleapis.com") and (path.rstrip("/") == "/v1/translate")
        is_google_a = (host == "translate.googleapis.com") and (path.rstrip("/") == "/translate_a/single")

        src_text = str(text or "")
        md_ctx: Optional[_GoogleFreeMdCtx] = None
        if want_google_md and (is_google_pa or is_google_a):
            src_text, md_ctx = _googlefree_build_md_preserve_input(src_text)

        if is_google_pa:
            # Unofficial Google Translate endpoint used by some community tools.
            # NOTE: This is not the paid Cloud Translation API.
            to_lang = (qs.get("to") or qs.get("tl") or qs.get("target") or ["zh-CN"])[0] or "zh-CN"
            from_lang = (qs.get("from") or qs.get("sl") or qs.get("source") or ["auto"])[0] or "auto"
            display_lang = (qs.get("display") or ["en-US"])[0] or "en-US"
            key = (qs.get("key") or [""])[0].strip() or _GOOGLE_PA_DEFAULT_KEY
            params = {
                "params.client": "gtx",
                "query.source_language": str(from_lang),
                "query.target_language": str(to_lang),
                "query.display_language": str(display_lang),
                "data_types": "TRANSLATION",
                "key": str(key),
                "query.text": src_text,
            }
            full_url = base_url + "?" + urllib.parse.urlencode(params)
            # If the URL is too long (common for markdown with line markers), fall back to the older
            # translate_a/single endpoint via POST. Keep it 1-request and format-stable.
            if want_google_md and len(full_url) >= 6500:
                base_url = "https://translate.googleapis.com/translate_a/single"
                params2 = {
                    "client": "gtx",
                    "sl": str(from_lang),
                    "tl": str(to_lang),
                    "dt": "t",
                    "dj": 1,
                    "q": src_text,
                }
                data = urllib.parse.urlencode(params2).encode("utf-8")
                req = urllib.request.Request(base_url, data=data, method="POST")
                req.add_header("Content-Type", "application/x-www-form-urlencoded; charset=utf-8")
                is_google_pa = False
                is_google_a = True
            else:
                req = urllib.request.Request(full_url, method="GET")
            req.add_header("Accept", "application/json")
            # Avoid brotli/br because stdlib cannot decode it.
            req.add_header("Accept-Encoding", "identity")
            req.add_header("Accept-Language", "en-US,en;q=0.9")
            req.add_header("User-Agent", _GOOGLE_UA)
        elif is_google_a:
            # Legacy unofficial endpoint (no key required) used by many open-source projects.
            to_lang = (qs.get("to") or qs.get("tl") or qs.get("target") or ["zh-CN"])[0] or "zh-CN"
            from_lang = (qs.get("from") or qs.get("sl") or qs.get("source") or ["auto"])[0] or "auto"
            params = {
                "client": "gtx",
                "sl": str(from_lang),
                "tl": str(to_lang),
                "dt": "t",
                "dj": 1,
                "q": src_text,
            }
            method = "GET" if len(src_text) <= 1800 else "POST"
            if method == "GET":
                full_url = base_url + "?" + urllib.parse.urlencode(params)
                req = urllib.request.Request(full_url, method="GET")
            else:
                data = urllib.parse.urlencode(params).encode("utf-8")
                req = urllib.request.Request(base_url, data=data, method="POST")
                req.add_header("Content-Type", "application/x-www-form-urlencoded; charset=utf-8")
            req.add_header("Accept", "application/json")
            req.add_header("Accept-Encoding", "identity")
            req.add_header("Accept-Language", "en-US,en;q=0.9")
            req.add_header("User-Agent", _GOOGLE_UA)
        elif is_translate_json:
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
        if token and not (is_google_pa or is_google_a):
            req.add_header(self.auth_header, compose_auth_value(self.auth_prefix, token))
        try:
            with urllib.request.urlopen(req, timeout=self.timeout_s) as resp:
                raw = resp.read()
                ctype = str(resp.headers.get("Content-Type") or "")
            def _maybe_restore(txt: str) -> str:
                if md_ctx is None:
                    return txt
                try:
                    return _googlefree_restore_md(txt, md_ctx)
                except Exception:
                    return txt
            try:
                obj = json.loads(raw.decode("utf-8", errors="replace"))
            except ValueError:
                # If server returns plain text (non-JSON), try to use it.
                try:
                    if "application/json" not in (ctype or "").lower():
                        txt = raw.decode("utf-8", errors="replace").strip()
                        if txt and not txt.lstrip().startswith("<"):
                            return _maybe_restore(txt)
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
                        return _maybe_restore(first)
                for k in ("text", "data", "result", "translation", "translated_text"):
                    v = obj.get(k)
                    if isinstance(v, str) and v.strip():
                        return _maybe_restore(v)
                    if isinstance(v, dict):
                        for kk in ("text", "data", "result", "translation", "translated_text"):
                            vv = v.get(kk)
                            if isinstance(vv, str) and vv.strip():
                                return _maybe_restore(vv)
                # DeepL-like shape: {"translations":[{"text":"..."}]}
                tr = obj.get("translations")
                if isinstance(tr, list) and tr:
                    first = tr[0]
                    if isinstance(first, dict):
                        t = first.get("text")
                        if isinstance(t, str) and t.strip():
                            return _maybe_restore(t)
                # Google translate_a/single (dj=1): {"sentences":[{"trans":"..."}]}
                sents = obj.get("sentences")
                if isinstance(sents, list) and sents:
                    parts = []
                    for s in sents:
                        if not isinstance(s, dict):
                            continue
                        t = s.get("trans")
                        if isinstance(t, str) and t:
                            parts.append(t)
                    joined = "".join(parts).strip()
                    if joined:
                        return _maybe_restore(joined)
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
