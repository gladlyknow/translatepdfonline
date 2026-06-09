from functools import lru_cache
from pathlib import Path
import os

from dotenv import load_dotenv
from pydantic_settings import BaseSettings
from pydantic import AnyUrl


# 后端仅使用项目根目录的 .env，确保无论当前工作目录在哪都能读到配置。
# 可通过环境变量 PROJECT_ROOT 指定项目根（绝对路径），便于与 Worker 一致
_env_project_root = os.getenv("PROJECT_ROOT", "").strip()
PROJECT_ROOT = Path(_env_project_root).resolve() if _env_project_root else Path(__file__).resolve().parents[2]
load_dotenv(PROJECT_ROOT / ".env")


class Settings(BaseSettings):
    """应用基础配置，从环境变量读取，便于后端服务器迁移。"""

    app_name: str = "translatepdfonline-api"
    environment: str = os.getenv("ENVIRONMENT", "local")

    database_url: AnyUrl  # 必填：postgres://...
    redis_url: AnyUrl = "redis://localhost:6379/0"

    jwt_secret: str = os.getenv("JWT_SECRET", "dev-jwt-secret")
    auth_secret: str = os.getenv("AUTH_SECRET", os.getenv("JWT_SECRET", "dev-jwt-secret"))
    app_secret: str = os.getenv("APP_SECRET", "dev-app-secret")

    api_base_prefix: str = "/api"
    # CORS 允许的前端来源，逗号分隔。生产需包含前端实际域名，例如：
    # https://translatepdfonline.pages.dev,https://www.translatepdfonline.com
    frontend_origins: str = os.getenv("FRONTEND_ORIGINS", "http://localhost:3000")

    # BabelDOC + DeepSeek（key 去除首尾空格，避免 .env 换行导致 401）
    deepseek_api_key: str = os.getenv("DEEPSEEK_API_KEY", "").strip()
    deepseek_base_url: str = os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com")
    deepseek_model: str = os.getenv("DEEPSEEK_MODEL", "deepseek-chat")
    babeldoc_staging_dir: str = os.getenv("BABELDOC_STAGING_DIR", "")
    babeldoc_output_dir: str = os.getenv("BABELDOC_OUTPUT_DIR", "")

    # BabelDOC 隔离到 FC：True 时 Worker 通过 HTTP 调 FC 执行翻译，False 时本地调用 run_translate
    babeldoc_use_fc: bool = os.getenv("BABELDOC_USE_FC", "false").strip().lower() in ("1", "true", "yes")
    # FC 规格：cpu 或 gpu，决定使用 BABELDOC_FC_URL_CPU 还是 BABELDOC_FC_URL_GPU；后期切 GPU 只需改此处
    babeldoc_fc_spec: str = (os.getenv("BABELDOC_FC_SPEC", "cpu") or "cpu").strip().lower()
    babeldoc_fc_url_cpu: str = os.getenv("BABELDOC_FC_URL_CPU", "").strip()
    babeldoc_fc_url_gpu: str = os.getenv("BABELDOC_FC_URL_GPU", "").strip()
    # 实际使用的 FC URL：按 spec 选用 URL_CPU/URL_GPU，未配置时回退到 BABELDOC_FC_URL（兼容只配一个 URL）
    babeldoc_fc_url: str = os.getenv("BABELDOC_FC_URL", "").strip()
    babeldoc_fc_secret: str = os.getenv("BABELDOC_FC_SECRET", "").strip()
    # 调用 FC 的 HTTP 超时（秒）；大文件可调大（如 1200），且 FC 控制台「执行超时」需 >= 此值
    babeldoc_fc_timeout_seconds: int = int(os.getenv("BABELDOC_FC_TIMEOUT_SECONDS", "600"))

    # Cloudflare R2（S3 兼容存储）
    r2_account_id: str = os.getenv("R2_ACCOUNT_ID", "")
    r2_bucket_name: str = os.getenv("R2_BUCKET_NAME", "")
    r2_access_key_id: str = os.getenv("R2_ACCESS_KEY_ID", "")
    r2_secret_access_key: str = os.getenv("R2_SECRET_ACCESS_KEY", "")
    r2_endpoint_url: str = os.getenv("R2_ENDPOINT_URL", "")
    r2_public_url: str = os.getenv("R2_PUBLIC_URL", "")

    # Google OAuth
    google_client_id: str = os.getenv("GOOGLE_CLIENT_ID", "")
    google_client_secret: str = os.getenv("GOOGLE_CLIENT_SECRET", "")
    google_redirect_uri: str = os.getenv("GOOGLE_REDIRECT_URI", "http://localhost:8000/api/auth/google/callback")

    # Resend 发信（注册验证码）。本地未配置 RESEND_FROM 时用 Resend 沙箱发件人，无需验证域名
    resend_api_key: str = os.getenv("RESEND_API_KEY", "").strip()
    resend_from: str = os.getenv("RESEND_FROM", "").strip()

    # 翻译限流与并发（生产环境 ECS）
    translation_max_concurrent: int = int(os.getenv("TRANSLATION_MAX_CONCURRENT", "4"))
    rate_limit_translate_per_minute: int = int(os.getenv("RATE_LIMIT_TRANSLATE_PER_MINUTE", "10"))


@lru_cache()
def get_settings() -> Settings:
    return Settings()


def get_babeldoc_fc_url_effective() -> str:
    """按 BABELDOC_FC_SPEC 返回实际使用的 FC URL（cpu 用 URL_CPU，gpu 用 URL_GPU，未配则回退 BABELDOC_FC_URL）。"""
    s = get_settings()
    if not s.babeldoc_use_fc:
        return ""
    spec = (s.babeldoc_fc_spec or "cpu").strip().lower()
    if spec == "gpu" and s.babeldoc_fc_url_gpu:
        return s.babeldoc_fc_url_gpu
    if s.babeldoc_fc_url_cpu:
        return s.babeldoc_fc_url_cpu
    return s.babeldoc_fc_url or ""


