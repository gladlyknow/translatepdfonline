"""add users.avatar_url for profile image"""
from __future__ import annotations
from alembic import op
revision = "20260306_0006"
down_revision = "20260304_0005"
branch_labels = None
depends_on = None
def upgrade() -> None:
    op.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url varchar(512)")
def downgrade() -> None:
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS avatar_url")
