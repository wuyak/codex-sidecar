import threading
import time
from http.server import ThreadingHTTPServer
from typing import Any, Optional

from .http.handler import SidecarHandler
from .http.state import SidecarState


class _ReuseHTTPServer(ThreadingHTTPServer):
    # Allow quick restart during iterative development (avoid EADDRINUSE from TIME_WAIT).
    allow_reuse_address = True


class SidecarServer:
    def __init__(self, host: str, port: int, max_messages: int, controller: Optional[Any] = None) -> None:
        self._host = host
        self._port = port
        self._state = SidecarState(max_messages=max_messages)
        self._httpd = _ReuseHTTPServer((host, port), SidecarHandler)
        # Attach state to server instance for handler access.
        self._httpd.state = self._state  # type: ignore[attr-defined]
        self._httpd.controller = controller  # type: ignore[attr-defined]
        self._thread: Optional[threading.Thread] = None

    @property
    def state(self) -> SidecarState:
        return self._state

    def set_controller(self, controller: Any) -> None:
        self._httpd.controller = controller  # type: ignore[attr-defined]

    def start_in_background(self) -> None:
        t = threading.Thread(target=self._httpd.serve_forever, name="sidecar-httpd", daemon=True)
        t.start()
        self._thread = t
        # Small delay to reduce race when watcher starts immediately.
        time.sleep(0.05)

    def shutdown(self) -> None:
        try:
            self._httpd.shutdown()
            self._httpd.server_close()
            if self._thread is not None and self._thread.is_alive():
                self._thread.join(timeout=0.5)
        except Exception:
            return

