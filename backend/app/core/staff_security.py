import hashlib
import logging
import threading
import time
from collections import deque
from urllib.parse import urlsplit

from fastapi import Request

from app.core.config import settings
from app.core.errors import AppError


class StaffRateLimiter:
    def __init__(self):
        self.buckets: dict[str, deque[float]] = {}
        self.lock = threading.Lock()

    def check(self, request: Request, action: str, limit: int):
        # shortcut: 프로세스별 인메모리 제한. 다중 worker/인스턴스 도입 시 공유 저장소로 전환.
        key = hashlib.sha256(
            f"{request.client.host if request.client else 'unknown'}:{action}".encode()
        ).hexdigest()
        now = time.monotonic()
        with self.lock:
            self.buckets = {k: v for k, v in self.buckets.items() if v and v[-1] > now - 60}
            if key not in self.buckets and len(self.buckets) >= 10000:
                raise AppError(429, "STAFF_RATE_LIMIT", "잠시 후 다시 시도해 주세요.")
            bucket = self.buckets.setdefault(key, deque())
            while bucket and bucket[0] <= now - 60:
                bucket.popleft()
            if len(bucket) >= limit:
                raise AppError(
                    429, "STAFF_RATE_LIMIT", "요청이 많습니다. 잠시 후 다시 시도해 주세요."
                )
            bucket.append(now)


limiter = StaffRateLimiter()


def check_origin(request: Request, frontend_url: str, code: str):
    origin = request.headers.get("origin")
    allowed = settings.cors_origins_list
    frontend = urlsplit(frontend_url)
    frontend_origin = f"{frontend.scheme}://{frontend.netloc}"
    if not origin or origin not in allowed or origin != frontend_origin:
        raise AppError(403, code, "허용된 화면에서 다시 시도해 주세요.")
    limiter.check(request, request.url.path, 60)


def protect_change(request: Request):
    check_origin(request, settings.staff_frontend_url, "STAFF_ORIGIN")


def protect_owner_change(request: Request):
    check_origin(request, settings.owner_frontend_url, "OWNER_ORIGIN")


class RedactOAuthAccessLog(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        if isinstance(record.args, tuple) and len(record.args) >= 3:
            args = list(record.args)
            path = args[2]
            if isinstance(path, str) and ("/auth/kakao" in path or "/auth/owner/kakao" in path):
                args[2] = path.split("?", 1)[0]
                record.args = tuple(args)
        return True


def install_log_redaction():
    logger = logging.getLogger("uvicorn.access")
    if not any(isinstance(f, RedactOAuthAccessLog) for f in logger.filters):
        logger.addFilter(RedactOAuthAccessLog())
