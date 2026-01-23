import json
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any, Dict


@dataclass
class HttpIngestClient:
    server_url: str
    timeout_s: float = 2.0

    def ingest(self, msg: Dict[str, Any]) -> bool:
        url = self.server_url.rstrip("/") + "/ingest"
        data = json.dumps(msg, ensure_ascii=False).encode("utf-8")
        req = urllib.request.Request(url, data=data, method="POST")
        req.add_header("Content-Type", "application/json; charset=utf-8")
        try:
            with urllib.request.urlopen(req, timeout=self.timeout_s) as resp:
                return 200 <= resp.status < 300
        except (urllib.error.URLError, urllib.error.HTTPError):
            return False

