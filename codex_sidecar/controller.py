"""
Sidecar controller facade（向后兼容）。

核心实现迁移到 `codex_sidecar.controller_core`，该文件仅保留旧导入路径：

  - from codex_sidecar.controller import SidecarController
"""

from .controller_core import SidecarController
from .control.translator_build import build_translator

__all__ = [
    "SidecarController",
    "build_translator",
]
