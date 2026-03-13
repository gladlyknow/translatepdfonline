import logging
from datetime import datetime, timedelta, timezone
import uuid
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, Depends, UploadFile
from sqlalchemy.orm import Session

from ..config import get_settings
from ..db import get_db
from ..models import Document, TranslationTask, User
from ..auth_utils import get_current_user_or_temp
from ..tasks_pdf import preprocess_pdf
from ..pdf_utils import get_pdf_page_count
from ..storage_r2 import create_presigned_put, is_r2_configured, delete_object as r2_delete_object
from ..schemas import (
    PresignedUploadRequest,
    PresignedUploadResponse,
    PresignedSliceRequest,
    PresignedSliceResponse,
    InitMultipartRequest,
    InitMultipartResponse,
    CompleteMultipartRequest,
    CompleteMultipartResponse,
    CompletePresignedUploadRequest,
    CompletePresignedUploadResponse,
    DocumentSummary,
)


router = APIRouter(tags=["upload"])

settings = get_settings()


def _reject_temp_user_second_upload(user: User, db: Session) -> None:
    """临时用户已有 1 个文档时拒绝再次上传，要求登录。"""
    if user.is_temporary:
        existing = db.query(Document).filter(Document.user_id == user.id).count()
        if existing >= 1:
            raise HTTPException(
                status_code=403,
                detail="login_required_for_multiple_documents",
            )


@router.post("/upload/direct", response_model=CompleteMultipartResponse)
def direct_upload(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user_or_temp),
) -> CompleteMultipartResponse:
    """
    直接上传 PDF 文件（用于本地开发，无 R2 时）。
    将文件保存到 BABELDOC_STAGING_DIR，并创建 Document 记录。
    """
    _reject_temp_user_second_upload(user, db)
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are accepted")
    project_root = Path(__file__).resolve().parents[3]  # backend/app/routes -> project root
    staging = Path(settings.babeldoc_staging_dir) if settings.babeldoc_staging_dir else (project_root / "tmp" / "staging")
    staging = staging.resolve()
    staging.mkdir(parents=True, exist_ok=True)
    object_key = f"uploads/{uuid.uuid4().hex}/{file.filename}"
    dest = staging / object_key
    dest.parent.mkdir(parents=True, exist_ok=True)
    content = file.file.read()
    size_bytes = len(content)
    dest.write_bytes(content)
    # 计算页数（生产环境可替换为 BabelDOC/MinerU 统一预处理）
    try:
        page_count = get_pdf_page_count(dest)
    except Exception:
        page_count = None

    expires_at = datetime.now(timezone.utc) + timedelta(days=7)
    doc = Document(
        user_id=user.id,
        object_key=object_key,
        filename=file.filename,
        size_bytes=size_bytes,
        page_count=page_count,
        expires_at=expires_at,
    )
    db.add(doc)
    db.commit()
    db.refresh(doc)
    preprocess_pdf.delay(str(doc.id), doc.object_key)
    return CompleteMultipartResponse(document_id=str(doc.id))


@router.post("/upload/presigned", response_model=PresignedUploadResponse)
def create_presigned_upload(
    req: PresignedUploadRequest,
    user: User = Depends(get_current_user_or_temp),
    db: Session = Depends(get_db),
) -> PresignedUploadResponse:
    """
    返回一个用于前端直传对象存储的预签名 URL。

    当前实现只生成占位形式的 URL（未真正对接 Cloudflare R2），
    主要用于打通前后端接口与请求参数验证。
    后续会在独立的 storage 适配层中接入真实的 R2 签名逻辑。
    """
    _reject_temp_user_second_upload(user, db)
    max_size_bytes = 50 * 1024 * 1024  # TODO: 后续根据用户等级从配置/数据库读取
    if req.size_bytes > max_size_bytes:
        raise HTTPException(status_code=400, detail="File too large")

    # 对象键名：后续可根据 user_id、日期等信息扩展
    object_key = f"uploads/{uuid.uuid4().hex}/{req.filename}"

    # 生成 Cloudflare R2 预签名上传 URL
    upload_url = create_presigned_put(object_key, req.content_type)

    expires_at = datetime.now(timezone.utc) + timedelta(minutes=10)

    return PresignedUploadResponse(
        upload_url=upload_url,
        object_key=object_key,
        expires_at=expires_at,
    )


@router.post("/upload/presigned/complete", response_model=CompletePresignedUploadResponse)
def complete_presigned_upload(
    req: CompletePresignedUploadRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user_or_temp),
) -> CompletePresignedUploadResponse:
    """
    浏览器使用预签名 URL 直传 R2 完成后，通知后端创建 Document，并触发预处理任务。
    """
    if req.size_bytes <= 0:
        raise HTTPException(status_code=400, detail="Invalid size_bytes")

    # 临时访客只允许上传一个文档，超过后要求登录
    if user.is_temporary:
        existing_count = (
            db.query(Document)
            .filter(Document.user_id == user.id)
            .count()
        )
        if existing_count >= 1:
            raise HTTPException(
                status_code=403,
                detail="login_required_for_multiple_documents",
            )

    expires_at = datetime.now(timezone.utc) + timedelta(days=7)
    doc = Document(
        user_id=user.id,
        object_key=req.object_key,
        filename=req.filename,
        size_bytes=req.size_bytes,
        expires_at=expires_at,
    )
    db.add(doc)
    db.commit()
    db.refresh(doc)

    # 触发异步预处理任务：从 R2 下载到本地 staging 目录，由 BabelDOC/MinerU 使用
    preprocess_pdf.delay(str(doc.id), doc.object_key)

    return CompletePresignedUploadResponse(document_id=str(doc.id))


@router.post("/upload/presigned-slice", response_model=PresignedSliceResponse)
def create_presigned_slice_upload(
    req: PresignedSliceRequest,
    user: User = Depends(get_current_user_or_temp),
    db: Session = Depends(get_db),
) -> PresignedSliceResponse:
    """
    申请用于上传「源 PDF 按页切分」切片的预签名 PUT URL。
    前端用 pdf-lib 等生成切片 PDF 后，PUT 到返回的 URL，再在 POST /translate 时传入 source_slice_object_key。
    """
    if not is_r2_configured():
        raise HTTPException(status_code=503, detail="Slice upload requires R2 storage to be configured")
    doc = db.query(Document).filter(Document.id == req.document_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    if str(doc.user_id) != str(user.id):
        raise HTTPException(status_code=404, detail="Document not found")
    # 键名包含 user_id 与 document_id，便于 /translate 时校验
    unique = uuid.uuid4().hex[:12]
    slice_object_key = f"slices/{user.id}/{doc.id}/{req.page_range.replace('-', '_')}_{unique}.pdf"
    upload_url = create_presigned_put(slice_object_key, "application/pdf", expires_minutes=15)
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=15)
    return PresignedSliceResponse(
        upload_url=upload_url,
        slice_object_key=slice_object_key,
        expires_at=expires_at,
    )


@router.post("/upload/multipart/init", response_model=InitMultipartResponse)
def init_multipart_upload(
    req: InitMultipartRequest,
    user: User = Depends(get_current_user_or_temp),
    db: Session = Depends(get_db),
) -> InitMultipartResponse:
    """
    初始化大文件分片上传，会返回 upload_id 和对象键名。

    当前实现仍为占位实现，不与真实 R2 交互，仅供前端按文档进行接口联调。
    """
    _reject_temp_user_second_upload(user, db)
    max_size_bytes = 500 * 1024 * 1024  # 大文件上限占位值
    if req.size_bytes > max_size_bytes:
        raise HTTPException(status_code=400, detail="File too large for multipart upload")

    upload_id = uuid.uuid4().hex
    object_key = f"multipart/{upload_id}/{req.filename}"

    # bucket/region 为占位字段，后续在对接 Cloudflare R2 时填充
    return InitMultipartResponse(
        upload_id=upload_id,
        bucket="r2-bucket-placeholder",
        key=object_key,
        region="auto",
    )


@router.post("/upload/multipart/complete", response_model=CompleteMultipartResponse)
def complete_multipart_upload(
    req: CompleteMultipartRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user_or_temp),
) -> CompleteMultipartResponse:
    """
    通知后端前端分片上传已全部成功。

    当前实现仅返回一个占位的 document_id，尚未写入数据库或触发解析任务。
    后续会在此位置：
      - 记录 documents 表
      - 触发 Celery 的 preprocess_pdf 任务
    """
    if req.size_bytes <= 0:
        raise HTTPException(status_code=400, detail="Invalid size_bytes")

    _reject_temp_user_second_upload(user, db)
    expires_at = datetime.now(timezone.utc) + timedelta(days=7)
    doc = Document(
        user_id=user.id,
        object_key=req.key,
        filename=req.filename,
        size_bytes=req.size_bytes,
        expires_at=expires_at,
    )
    db.add(doc)
    db.commit()
    db.refresh(doc)

    # 触发异步预处理任务（BabelDOC / MinerU 集成将在任务内部完成）
    preprocess_pdf.delay(str(doc.id), doc.object_key)

    return CompleteMultipartResponse(document_id=str(doc.id))


@router.delete("/documents/{document_id}", status_code=204)
def delete_document(
    document_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user_or_temp),
) -> None:
    """
    删除用户上传的文档：从 R2 删除对象并删除 DB 记录。仅文档所属用户可删。
    """
    doc = db.query(Document).filter(Document.id == document_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    if str(doc.user_id) != str(user.id):
        raise HTTPException(status_code=403, detail="Not your document")
    if is_r2_configured():
        try:
            r2_delete_object(doc.object_key)
        except Exception as e:
            # 可能为本地直传的文档，R2 中无此 key；记录日志但继续删 DB
            logging.getLogger(__name__).warning("delete_document R2 delete_object failed doc_id=%s key=%s: %s", document_id, doc.object_key, e)
    # 本地 staging 若有该路径也尝试删除（直传场景）
    if settings.babeldoc_staging_dir:
        try:
            local_path = Path(settings.babeldoc_staging_dir) / doc.object_key
            if local_path.exists() and local_path.is_file():
                local_path.unlink()
        except Exception:
            pass
    # 先删除引用该文档的翻译任务，避免外键约束报错
    db.query(TranslationTask).filter(TranslationTask.document_id == doc.id).delete(synchronize_session=False)
    db.delete(doc)
    db.commit()
    return None


@router.get("/documents", response_model=list[DocumentSummary])
def list_documents(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user_or_temp),
) -> list[DocumentSummary]:
    """
    当前用户的文档列表；仅返回未过期的（expires_at 为空或 > 当前时间，默认保留 7 天）。
    """
    now = datetime.now(timezone.utc)
    docs = (
        db.query(Document)
        .filter(Document.user_id == user.id)
        .filter((Document.expires_at.is_(None)) | (Document.expires_at > now))
        .order_by(Document.created_at.desc())
        .limit(100)
        .all()
    )
    return [
        DocumentSummary(
            id=str(d.id),
            filename=d.filename,
            size_bytes=int(d.size_bytes),
            status=d.status,
            created_at=d.created_at,
        )
        for d in docs
    ]

