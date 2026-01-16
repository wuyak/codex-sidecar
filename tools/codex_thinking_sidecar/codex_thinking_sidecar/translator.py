"""
Translator facade (kept for backward compatibility).

Implementation lives under `codex_thinking_sidecar.translators.*`.
"""

from .translators import (
    HttpTranslator,
    NvidiaChatTranslator,
    NoneTranslator,
    OpenAIResponsesTranslator,
    StubTranslator,
    Translator,
)

__all__ = [
    "Translator",
    "StubTranslator",
    "NoneTranslator",
    "HttpTranslator",
    "OpenAIResponsesTranslator",
    "NvidiaChatTranslator",
]
