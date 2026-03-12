from datetime import datetime
from typing import Optional

from pydantic import BaseModel, EmailStr, Field


class PresignedUploadRequest(BaseModel):
    filename: str = Field(..., description="原始文件名，例如 paper.pdf")
    size_bytes: int = Field(..., ge=1, description="文件大小（字节）")
    content_type: str = Field("application/pdf", description="MIME 类型，默认 application/pdf")


class PresignedUploadResponse(BaseModel):
    upload_url: str = Field(..., description="前端用于 PUT 上传的预签名 URL")
    object_key: str = Field(..., description="在对象存储中的唯一对象键名")
    expires_at: datetime = Field(..., description="预签名 URL 失效时间（UTC）")


class InitMultipartRequest(BaseModel):
    filename: str = Field(..., description="原始文件名，例如 big-paper.pdf")
    size_bytes: int = Field(..., ge=1, description="文件大小（字节）")
    content_type: str = Field("application/pdf", description="MIME 类型")


class InitMultipartResponse(BaseModel):
    upload_id: str = Field(..., description="多段上传会话 ID，由后端生成")
    bucket: str = Field(..., description="目标存储 bucket（占位字段）")
    key: str = Field(..., description="对象键名，后续 complete 时需要带上")
    region: str = Field(..., description="存储区域（占位字段）")


class CompleteMultipartRequest(BaseModel):
    upload_id: str = Field(..., description="初始化阶段返回的 upload_id")
    key: str = Field(..., description="对象键名")
    filename: str = Field(..., description="原始文件名")
    size_bytes: int = Field(..., ge=1, description="文件大小（字节）")


class CompleteMultipartResponse(BaseModel):
    document_id: str = Field(..., description="后端内部的文档 ID，占位字段，后续会接入真实 DB")


class CompletePresignedUploadRequest(BaseModel):
    object_key: str = Field(..., description="上传到 R2 的对象键名")
    filename: str = Field(..., description="原始文件名")
    size_bytes: int = Field(..., ge=1, description="文件大小（字节）")


class CompletePresignedUploadResponse(BaseModel):
    document_id: str = Field(..., description="后端内部文档 ID")


class PresignedSliceRequest(BaseModel):
    document_id: str = Field(..., description="文档 ID，切片将与该文档关联")
    page_range: str = Field(..., description="页码范围，例如 '1-5' 或 '3'")


class PresignedSliceResponse(BaseModel):
    upload_url: str = Field(..., description="用于 PUT 上传切片 PDF 的预签名 URL")
    slice_object_key: str = Field(..., description="R2 中切片对象的 key，创建翻译任务时传入 source_slice_object_key")
    expires_at: datetime = Field(..., description="预签名 URL 过期时间（UTC）")


class TranslateRequest(BaseModel):
    document_id: str = Field(..., description="待翻译文档的 ID")
    source_lang: str = Field(..., description="源语言代码，例如 zh/en/es")
    target_lang: str = Field(..., description="目标语言代码，例如 zh/en/es")
    page_range: Optional[str] = Field(None, description="页码范围字符串，例如 '1-10'")
    source_slice_object_key: Optional[str] = Field(
        None,
        description="前端按页切分后上传到 R2 的切片对象 key，有则翻译时直接使用该 PDF",
    )
    preprocess_with_ocr: Optional[bool] = Field(
        False,
        description="是否先用 OCR 处理 PDF 再翻译（适用于扫描件或图片较多的 PDF）",
    )


class TranslateResponse(BaseModel):
    task_id: str = Field(..., description="翻译任务 ID")


class TaskDetail(BaseModel):
    id: str
    document_id: str
    source_lang: str
    target_lang: str
    page_range: Optional[str]
    status: str
    created_at: datetime
    updated_at: datetime
    error_code: Optional[str] = None
    error_message: Optional[str] = None
    progress_percent: Optional[float] = None
    progress_stage: Optional[str] = None
    progress_current: Optional[int] = None
    progress_total: Optional[int] = None


class DocumentSummary(BaseModel):
    id: str
    filename: str
    size_bytes: int
    status: str
    created_at: datetime


class TaskSummary(BaseModel):
    id: str
    document_id: str
    status: str
    source_lang: str
    target_lang: str
    created_at: datetime
    document_filename: Optional[str] = None
    page_range: Optional[str] = None
    updated_at: Optional[datetime] = None


class TaskOutputFile(BaseModel):
    filename: str = Field(..., description="输出文件名（通常为 PDF）")
    download_url: str = Field(..., description="用于下载该输出文件的后端 URL")


class SendCodeRequest(BaseModel):
    email: EmailStr = Field(..., description="注册用邮箱")


class SendCodeResponse(BaseModel):
    ok: bool = Field(True, description="是否发送成功")


class VerifyRegisterRequest(BaseModel):
    email: EmailStr = Field(..., description="注册用邮箱")
    code: str = Field(..., min_length=1, max_length=10, description="验证码")
    password: str = Field(..., min_length=8, max_length=64, description="密码")
    confirm_password: str = Field(..., min_length=8, max_length=64, description="确认密码")


class EnsureUserRequest(BaseModel):
    email: EmailStr = Field(..., description="邮箱")
    name: Optional[str] = Field(None, description="显示名")


class LoginRequest(BaseModel):
    email: EmailStr = Field(..., description="登录邮箱")
    password: str = Field(..., description="密码")


class UserMeResponse(BaseModel):
    id: str
    email: Optional[str] = None
    display_name: Optional[str] = None
    avatar_url: Optional[str] = Field(None, description="当前用户头像 URL，同源 GET 即图片")


class TaskView(BaseModel):
    task: TaskDetail
    document_filename: str = Field(..., description="原始文档文件名")
    document_size_bytes: int = Field(0, description="原始文档大小（字节），用于预览区显示")
    outputs: list[TaskOutputFile] = Field(
        default_factory=list,
        description="该任务生成的输出文件列表（目前为翻译后的 PDF）",
    )
    primary_file_url: Optional[str] = Field(
        default=None,
        description="译文主文件预览/下载 URL（不包含文件名，避免编码问题），供 PDF 预览使用",
    )
    source_pdf_url: Optional[str] = Field(
        default=None,
        description="原始 PDF 的在线预览 URL（如 R2 公网地址），供前端对比预览使用",
    )
    can_download: bool = Field(
        default=True,
        description="当前用户是否允许下载（未登录临时用户仅可预览不可下载）",
    )



