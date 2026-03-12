"""
创建数据库表（开发用）。运行前确保 DATABASE_URL 已配置。
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.db import Base, engine
from app.models import Document, TranslationTask, User, Wallet

if __name__ == "__main__":
    Base.metadata.create_all(bind=engine)
    print("Tables created.")
