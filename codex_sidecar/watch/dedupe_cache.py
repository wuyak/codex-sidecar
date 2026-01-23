from typing import Set


class DedupeCache:
    """
    轻量去重缓存。

    说明：
    - 该 sidecar 的去重目标是“避免重复推送”，无需严格 LRU/TTL。
    - 超过阈值后直接清空集合是可接受的近似（重复数据是有界且无害的）。
    - 保留 (key, kind) 形参以兼容旧调用（例如 TUI gate tailer）。
    """

    def __init__(self, max_size: int = 5000) -> None:
        try:
            n = int(max_size)
        except Exception:
            n = 5000
        self._max_size = n if n > 0 else 5000
        self._seen: Set[str] = set()

    def __call__(self, key: str, kind: str = "") -> bool:
        _ = kind  # 兼容旧签名；当前实现不按 kind 分桶
        k = str(key or "")
        if not k:
            return False
        if k in self._seen:
            return True
        self._seen.add(k)
        if len(self._seen) > self._max_size:
            self._seen.clear()
            self._seen.add(k)
        return False

