import uuid
from datetime import datetime

from sqlalchemy import Column, String, DateTime, BigInteger, ForeignKey, Boolean
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from .db import Base


def _uuid_str() -> str:
    return uuid.uuid4().hex


class User(Base):
    __tablename__ = "users"

    id = Column(UUID(as_uuid=False), primary_key=True, default=_uuid_str)
    email = Column(String(255), nullable=True, unique=True)
    phone = Column(String(32), nullable=True, unique=True)
    display_name = Column(String(128), nullable=True)
    preferred_locale = Column(String(8), nullable=False, default="en")
    is_temporary = Column(Boolean, nullable=False, default=False)
    quota_pages_total = Column(BigInteger, nullable=False, default=5)
    quota_pages_used = Column(BigInteger, nullable=False, default=0)
    password_hash = Column(String(255), nullable=True)
    avatar_url = Column(String(512), nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)


class Wallet(Base):
    __tablename__ = "wallets"

    id = Column(UUID(as_uuid=False), primary_key=True, default=_uuid_str)
    user_id = Column(UUID(as_uuid=False), ForeignKey("users.id"), nullable=False, unique=True)
    balance = Column(BigInteger, nullable=False, default=0)
    frozen_balance = Column(BigInteger, nullable=False, default=0)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow)


class Document(Base):
    __tablename__ = "documents"

    id = Column(UUID(as_uuid=False), primary_key=True, default=_uuid_str)
    user_id = Column(UUID(as_uuid=False), ForeignKey("users.id"), nullable=True)
    object_key = Column(String, nullable=False)
    filename = Column(String, nullable=False)
    size_bytes = Column(BigInteger, nullable=False)
    page_count = Column(BigInteger, nullable=True)
    status = Column(String(32), nullable=False, default="uploaded")
    expires_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)

    user = relationship("User")


class TranslationTask(Base):
    __tablename__ = "translation_tasks"

    id = Column(UUID(as_uuid=False), primary_key=True, default=_uuid_str)
    user_id = Column(UUID(as_uuid=False), ForeignKey("users.id"), nullable=True)
    document_id = Column(UUID(as_uuid=False), ForeignKey("documents.id"), nullable=False)
    source_lang = Column(String(8), nullable=False)
    target_lang = Column(String(8), nullable=False)
    page_range = Column(String, nullable=True)
    status = Column(String(32), nullable=False, default="pending")
    priority = Column(BigInteger, nullable=False, default=0)
    token_cost_estimated = Column(BigInteger, nullable=True)
    token_cost_actual = Column(BigInteger, nullable=True)
    error_code = Column(String(64), nullable=True)
    error_message = Column(String(512), nullable=True)
    output_primary_path = Column(String(1024), nullable=True)
    output_object_key = Column(String(512), nullable=True)
    source_slice_object_key = Column(String(512), nullable=True)
    preprocess_with_ocr = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow)

    user = relationship("User")
    document = relationship("Document")


