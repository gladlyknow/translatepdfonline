from __future__ import annotations

import sys

import redis

from app.config import get_settings


def main() -> None:
    settings = get_settings()
    url = str(settings.redis_url)
    try:
        client = redis.from_url(url, socket_connect_timeout=3, socket_timeout=3)
        client.ping()
    except Exception as exc:
        print(f"Redis health check FAILED for {url}: {exc}", file=sys.stderr)
        sys.exit(1)

    print(f"Redis health check OK for {url}")
    sys.exit(0)


if __name__ == "__main__":
    main()

