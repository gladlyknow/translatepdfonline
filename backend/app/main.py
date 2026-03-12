from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import get_settings
from .routes import upload, tasks, auth, user


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


@app.get("/health", tags=["system"])
def health_check():
    """基础健康检查，用于 Cloudflare / 负载均衡探活。"""
    return {"status": "ok", "env": settings.environment}


# 业务路由挂载在统一的 API 前缀下，便于版本控制与网关转发
app.include_router(upload.router, prefix=settings.api_base_prefix)
app.include_router(tasks.router, prefix=settings.api_base_prefix)
app.include_router(auth.router, prefix=settings.api_base_prefix)
app.include_router(user.router, prefix=settings.api_base_prefix)



