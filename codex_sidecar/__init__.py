from typing import Any

__all__ = ["main"]


def main(argv: Any = None) -> int:
    # Lazy import to avoid pulling in the full CLI/controller stack when importing
    # leaf modules (security/config/translators) from the package.
    from .cli import main as _main

    return int(_main(argv))
