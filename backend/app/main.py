import logging
import time

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from .config import get_settings
from .routes import upload, tasks, auth, user

logger = logging.getLogger(__name__)
settings = get_settings()

app = FastAPI(
    title=settings.app_name,
    openapi_url=f"{settings.api_base_prefix}/openapi.json",
    docs_url=f"{settings.api_base_prefix}/docs",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in settings.frontend_origins.split(",") if o.strip()],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def access_log_middleware(request: Request, call_next):
    """记录访问日志：方法、路径、状态码、耗时、是否带 Bearer 鉴权，便于排查 CORS/鉴权问题。"""
    if request.url.path == "/health":
        return await call_next(request)
    start = time.perf_counter()
    auth_header = request.headers.get("Authorization") or ""
    has_bearer = auth_header.lower().startswith("bearer ") and len(auth_header.strip()) > 7
    response = await call_next(request)
    duration_ms = (time.perf_counter() - start) * 1000
    logger.info(
        "access method=%s path=%s status=%s duration_ms=%.0f has_bearer=%s",
        request.method,
        request.url.path,
        response.status_code,
        duration_ms,
        has_bearer,
    )
    return response


@app.get("/health", tags=["system"])
def health_check():
    """基础健康检查，用于 Cloudflare / 负载均衡探活。仅返回固定 JSON，不依赖 settings/DB/Redis。"""
    return {"status": "ok"}


# 业务路由挂载在统一的 API 前缀下，便于版本控制与网关转发
app.include_router(upload.router, prefix=settings.api_base_prefix)
app.include_router(tasks.router, prefix=settings.api_base_prefix)
app.include_router(auth.router, prefix=settings.api_base_prefix)
app.include_router(user.router, prefix=settings.api_base_prefix)



