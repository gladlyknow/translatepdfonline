"""add user quota fields and translation task error fields

This migration adds:
- users.is_temporary, users.quota_pages_total, users.quota_pages_used
- translation_tasks.error_code, translation_tasks.error_message
"""

from __future__ import annotations

from alembic import op


revision = "20260304_0002"
down_revision = "20260304_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 使用 IF NOT EXISTS 以兼容已手工执行过 ALTER TABLE 的环境
    op.execute(
        """
        ALTER TABLE users
        ADD COLUMN IF NOT EXISTS is_temporary boolean NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS quota_pages_total bigint NOT NULL DEFAULT 5,
        ADD COLUMN IF NOT EXISTS quota_pages_used bigint NOT NULL DEFAULT 0
        """
    )
    op.execute(
        """
        ALTER TABLE translation_tasks
        ADD COLUMN IF NOT EXISTS error_code varchar(64),
        ADD COLUMN IF NOT EXISTS error_message varchar(512)
        """
    )


def downgrade() -> None:
    op.execute(
        """
        ALTER TABLE translation_tasks
        DROP COLUMN IF EXISTS error_message,
        DROP COLUMN IF EXISTS error_code
        """
    )
    op.execute(
        """
        ALTER TABLE users
        DROP COLUMN IF EXISTS quota_pages_used,
        DROP COLUMN IF EXISTS quota_pages_total,
        DROP COLUMN IF EXISTS is_temporary
        """
    )

