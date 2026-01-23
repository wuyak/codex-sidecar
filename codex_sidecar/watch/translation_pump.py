"""
Translation pump facade（向后兼容）。

实现迁移到 `codex_sidecar.watch.translation_pump_core`，该文件仅保留旧导入路径：

  - from codex_sidecar.watch.translation_pump import TranslationPump
"""

from .translation_pump_core import TranslationPump

__all__ = [
    "TranslationPump",
]

