from collections import defaultdict, deque
from threading import Lock
from time import monotonic


class StoreQrRateLimiter:
    def __init__(self, limit: int, window_seconds: int):
        self.limit = limit
        self.window_seconds = window_seconds
        self._requests = defaultdict(deque)
        self._lock = Lock()

    def allow(self, key: str) -> bool:
        now = monotonic()
        cutoff = now - self.window_seconds
        with self._lock:
            requests = self._requests[key]
            while requests and requests[0] <= cutoff:
                requests.popleft()
            if len(requests) >= self.limit:
                return False
            requests.append(now)
            return True


scan_rate_limiter = StoreQrRateLimiter(limit=30, window_seconds=60)
submit_rate_limiter = StoreQrRateLimiter(limit=10, window_seconds=60)
