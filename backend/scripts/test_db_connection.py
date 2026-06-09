"""
测试数据库连接与 public schema 权限（与 Alembic / 应用使用同一 DATABASE_URL）。
在服务器上运行（需已配置 .env 且 PROJECT_ROOT 指向项目根）：
  cd /data/translatepdfonline/backend && ../.venv/bin/python scripts/test_db_connection.py
或本机：
  cd backend && python scripts/test_db_connection.py
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

# 保证能加载 app（与 alembic env.py 一致）
BACKEND_ROOT = Path(__file__).resolve().parents[1]
PROJECT_ROOT = BACKEND_ROOT.parent
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))
os.environ.setdefault("PROJECT_ROOT", str(PROJECT_ROOT))

from sqlalchemy import create_engine, text
from app.config import get_settings


def mask_url(url: str) -> str:
    """隐藏密码，便于打印"""
    if "@" in url and "://" in url:
        pre, rest = url.split("://", 1)
        if "@" in rest:
            creds, host_part = rest.rsplit("@", 1)
            if ":" in creds:
                user = creds.split(":")[0]
                return f"{pre}://{user}:****@{host_part}"
    return url


def main() -> None:
    settings = get_settings()
    url = str(settings.database_url)
    if url.startswith("postgres://"):
        url = url.replace("postgres://", "postgresql://", 1)

    print("=== 1. 使用的连接串（密码已隐藏）===")
    print(mask_url(url))
    print()

    engine = create_engine(url, pool_pre_ping=True)
    with engine.connect() as conn:
        # 当前连接信息
        row = conn.execute(text("SELECT current_user, current_database(), inet_server_addr()::text, inet_server_port()")).fetchone()
        print("=== 2. 当前连接信息 ===")
        print(f"  用户: {row[0]}")
        print(f"  数据库: {row[1]}")
        print(f"  主机: {row[2]} (端口 {row[3]})")
        print()

        # public schema 权限
        print("=== 3. public schema 权限（当前用户）===")
        for priv in ("USAGE", "CREATE"):
            r = conn.execute(
                text(
                    "SELECT has_schema_privilege(current_user, 'public', :priv)"
                ),
                {"priv": priv},
            ).fetchone()
            print(f"  public.{priv}: {r[0]}")
        print()

        # 尝试创建/删除测试表
        print("=== 4. 测试在 public 下建表 ===")
        try:
            conn.execute(text("CREATE TABLE _alembic_test_perm (id SERIAL PRIMARY KEY)"))
            conn.commit()
            print("  CREATE TABLE: 成功")
            conn.execute(text("DROP TABLE _alembic_test_perm"))
            conn.commit()
            print("  DROP TABLE: 成功")
        except Exception as e:
            print(f"  失败: {e}")
            conn.rollback()
    print()
    print("若 3 中 CREATE 为 False 或 4 失败，需用高权限用户执行：")
    print("  GRANT USAGE, CREATE ON SCHEMA public TO <你的数据库用户名>;")
    print("  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO <你的数据库用户名>;")


if __name__ == "__main__":
    main()
