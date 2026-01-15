import re
from typing import Dict, List, Optional, Set, Tuple

_TRANSLATE_BATCH_MAGIC = "<<<SIDECAR_TRANSLATE_BATCH_V1>>>"
_TRANSLATE_BATCH_ITEM_RE = re.compile(r"^<<<SIDECAR_ITEM:([^>]+)>>>\\s*$")
_TRANSLATE_BATCH_END = "<<<SIDECAR_END>>>"

def _pack_translate_batch(items: List[Tuple[str, str]]) -> str:
    """
    Pack multiple items into a single translation request.

    Format contract:
    - Markers must remain verbatim (do NOT translate them).
    - Translator should output the same markers and translated content between them.
    """
    lines = [
        "请将下列内容翻译为中文。",
        "要求：逐行原样保留所有形如 <<<SIDECAR_...>>> 的标记行（不要翻译、不要改动、不要增删）。",
        "输出必须包含最后一行 <<<SIDECAR_END>>>。",
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
