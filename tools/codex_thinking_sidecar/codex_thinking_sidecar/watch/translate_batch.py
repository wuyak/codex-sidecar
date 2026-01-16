import re
from typing import Dict, List, Optional, Set, Tuple

_TRANSLATE_BATCH_MAGIC = "<<<SIDECAR_TRANSLATE_BATCH_V1>>>"
_TRANSLATE_BATCH_ITEM_RE = re.compile(r"^<<<SIDECAR_ITEM:([^>]+)>>>\s*$")
_TRANSLATE_BATCH_END = "<<<SIDECAR_END>>>"

def _pack_translate_batch(items: List[Tuple[str, str]]) -> str:
    """
    Pack multiple items into a single translation request.

    Format contract:
    - Markers must remain verbatim (do NOT translate them).
    - Translator should output the same markers and translated content between them.
    """
    lines = [
        "你是翻译器。请把下列内容翻译成【简体中文】，只输出译文。",
        "通用要求：保留原有 Markdown/换行/空行；保留列表符号、缩进、`#` 标题前缀、``` 代码块围栏；代码块/命令/路径/变量名/JSON 原样不翻译；专有名词（API/HTTP/JSON/Codex/Sidecar/NVIDIA 等）原样保留；原文中文为主则原样返回。",
        "协议要求：以下内容包含若干条目。你必须按原顺序输出每个条目的标记行与对应译文：",
        "- 标记行形如 <<<SIDECAR_ITEM:<id>>> 与 <<<SIDECAR_END>>>，必须逐行原样保留（不要翻译、不要改动、不要增删）。",
        "- Markdown 标题行：对以 `#` 开头的标题，必须保留前缀（`#` 与后续空格），并翻译其后的标题文字（不要删除 `#`）。",
        "- 对于每个 <<<SIDECAR_ITEM:<id>>> 之后的内容：逐行翻译并原样保留换行；直到下一个标记行。",
        "- 最后一行必须是 <<<SIDECAR_END>>>。",
        "注意：不要输出任何额外说明文字；不要省略任何条目；不要只输出 <<<SIDECAR_END>>>。",
        "",
        _TRANSLATE_BATCH_MAGIC,
    ]
    for mid, text in items:
        lines.append(f"<<<SIDECAR_ITEM:{mid}>>>")
        lines.append(str(text or "").rstrip())
    lines.append(_TRANSLATE_BATCH_END)
    return "\n".join(lines).rstrip() + "\n"

def _unpack_translate_batch(output: str, wanted_ids: Set[str]) -> Dict[str, str]:
    """Extract per-item translations from a packed response."""
    out: Dict[str, str] = {}
    cur_id: Optional[str] = None
    buf: List[str] = []

    def _flush() -> None:
        nonlocal cur_id, buf
        if cur_id and cur_id in wanted_ids:
            out[cur_id] = "\n".join(buf).strip()
        cur_id = None
        buf = []

    for raw in str(output or "").splitlines():
        line = raw.strip()
        if not line:
            if cur_id is not None:
                buf.append("")
            continue
        if line == _TRANSLATE_BATCH_MAGIC:
            continue
        if line == _TRANSLATE_BATCH_END:
            _flush()
            break
        m = _TRANSLATE_BATCH_ITEM_RE.match(line)
        if m:
            _flush()
            cur_id = m.group(1).strip()
            buf = []
            continue
        if cur_id is not None:
            buf.append(raw)
    _flush()
    return out
