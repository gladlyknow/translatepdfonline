"""
FC 环境配置：从环境变量读取，与 backend/app/config 对齐（R2、DeepSeek）。
"""
from __future__ import annotations

import os


def get_deepseek_api_key() -> str:
    return (os.getenv("DEEPSEEK_API_KEY") or "").strip()


def get_deepseek_base_url() -> str:
    return (os.getenv("DEEPSEEK_BASE_URL") or "https://api.deepseek.com").strip()


def get_deepseek_model() -> str:
    return (os.getenv("DEEPSEEK_MODEL") or "deepseek-chat").strip()


def get_r2_config() -> dict:
    """R2 配置，用于上传结果 PDF。返回 dict 含 bucket, endpoint_url, access_key, secret_key。"""
    return {
        "bucket": (os.getenv("R2_BUCKET_NAME") or "").strip(),
        "endpoint_url": (os.getenv("R2_ENDPOINT_URL") or "").strip(),
        "access_key": (os.getenv("R2_ACCESS_KEY_ID") or "").strip(),
        "secret_key": (os.getenv("R2_SECRET_ACCESS_KEY") or "").strip(),
    }


def get_fc_secret() -> str:
    """FC 鉴权密钥，与 ECS 配置的 BABELDOC_FC_SECRET 一致。"""
    return (os.getenv("BABELDOC_FC_SECRET") or "").strip()
