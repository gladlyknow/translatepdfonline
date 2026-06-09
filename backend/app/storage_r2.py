from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Any

import boto3
from botocore.client import Config

from .config import get_settings


@lru_cache()
def get_r2_client() -> Any:
    """
    返回 Cloudflare R2 的 S3 兼容客户端。

    生产环境中通过环境变量配置访问凭据与 endpoint。
    """
    settings = get_settings()
    if not settings.r2_endpoint_url or not settings.r2_access_key_id or not settings.r2_secret_access_key:
        raise RuntimeError("R2 storage is not fully configured")

    session = boto3.session.Session()
    return session.client(
        "s3",
        endpoint_url=settings.r2_endpoint_url,
        aws_access_key_id=settings.r2_access_key_id,
        aws_secret_access_key=settings.r2_secret_access_key,
        config=Config(
            signature_version="s3v4",
            connect_timeout=30,
            read_timeout=120,
            retries={"max_attempts": 5, "mode": "standard"},
        ),
    )


def is_r2_configured() -> bool:
    """R2 是否已配置（有 bucket 与凭据），用于决定是否返回 presigned URL。"""
    settings = get_settings()
    return bool(
        settings.r2_bucket_name
        and settings.r2_access_key_id
        and settings.r2_secret_access_key
        and settings.r2_endpoint_url
    )


def create_presigned_put(object_key: str, content_type: str, expires_minutes: int = 10) -> str:
    """
    生成用于浏览器直传 R2 的预签名 PUT URL。
    """
    settings = get_settings()
    client = get_r2_client()
    return client.generate_presigned_url(
        "put_object",
        Params={
            "Bucket": settings.r2_bucket_name,
            "Key": object_key,
            "ContentType": content_type,
        },
        ExpiresIn=expires_minutes * 60,
    )


def create_presigned_get(object_key: str, expires_in_seconds: int = 3600) -> str:
    """
    生成用于浏览器直连 R2 读取对象的预签名 GET URL。
    预览/下载直连 R2 时使用，减轻后端流式代理压力。
    """
    settings = get_settings()
    client = get_r2_client()
    return client.generate_presigned_url(
        "get_object",
        Params={
            "Bucket": settings.r2_bucket_name,
            "Key": object_key,
        },
        ExpiresIn=expires_in_seconds,
    )


def download_to_path(object_key: str, dest: str | Path) -> Path:
    """
    将 R2 中的对象下载到本地指定路径。
    """
    settings = get_settings()
    client = get_r2_client()
    dest_path = Path(dest)
    dest_path.parent.mkdir(parents=True, exist_ok=True)
    client.download_file(settings.r2_bucket_name, object_key, str(dest_path))
    return dest_path


def upload_file(
    local_path: Path | str,
    object_key: str,
    content_type: str = "application/pdf",
) -> None:
    """
    将本地文件上传到 R2。用于译文 PDF 等。
    """
    settings = get_settings()
    client = get_r2_client()
    path = Path(local_path)
    if not path.exists() or not path.is_file():
        raise FileNotFoundError(f"Local file not found: {path}")
    client.upload_file(
        str(path),
        settings.r2_bucket_name,
        object_key,
        ExtraArgs={"ContentType": content_type},
    )


def get_object_stream(object_key: str):
    """
    从 R2 按块流式读取对象，用于后端代理 PDF 到浏览器，避免前端直连 R2 的 CORS 问题。
    返回 (content_type, chunk_iterator)。
    """
    settings = get_settings()
    client = get_r2_client()
    resp = client.get_object(Bucket=settings.r2_bucket_name, Key=object_key)
    content_type = resp.get("ContentType") or "application/pdf"
    # 不强制 Content-Disposition，由调用方按 disposition 参数设置
    body = resp["Body"]

    def iter_chunks():
        for chunk in body.iter_chunks():
            yield chunk

    return content_type, iter_chunks()


def delete_object(object_key: str) -> None:
    """
    从 R2 删除指定对象。用于用户删除已上传的 PDF 时同步清理 R2。
    """
    settings = get_settings()
    client = get_r2_client()
    client.delete_object(Bucket=settings.r2_bucket_name, Key=object_key)


def get_object_stream_range(object_key: str, range_header: str):
    """
    从 R2 按 Range 流式读取对象，用于 206 Partial Content 分片加载。
    range_header: 请求头 Range 的值，如 "bytes=0-65535"。
    返回 (content_type, chunk_iterator, content_length, content_range)。
    content_range 为 None 表示非 Range 响应；否则为 "bytes start-end/total" 格式，用于 Content-Range 头。
    """
    settings = get_settings()
    client = get_r2_client()
    resp = client.get_object(
        Bucket=settings.r2_bucket_name,
        Key=object_key,
        Range=range_header,
    )
    content_type = resp.get("ContentType") or "application/pdf"
    content_length = resp.get("ContentLength")
    content_range = resp.get("ContentRange")
    body = resp["Body"]

    def iter_chunks():
        for chunk in body.iter_chunks():
            yield chunk

    return content_type, iter_chunks(), content_length, content_range


