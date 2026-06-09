"""add users.password_hash for email/password registration"""

from __future__ import annotations

from alembic import op


revision = "20260304_0003"
down_revision = "20260304_0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE users
        ADD COLUMN IF NOT EXISTS password_hash varchar(255)
        """
    )


def downgrade() -> None:
    op.execute(
        """
        ALTER TABLE users
        DROP COLUMN IF EXISTS password_hash
        """
    )
