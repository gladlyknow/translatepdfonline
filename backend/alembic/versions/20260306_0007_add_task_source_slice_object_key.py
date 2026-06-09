"""add translation_tasks.source_slice_object_key for R2 source pages PDF"""
from __future__ import annotations
from alembic import op

revision = "20260306_0007"
down_revision = "20260306_0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE translation_tasks ADD COLUMN IF NOT EXISTS source_slice_object_key varchar(512)")


def downgrade() -> None:
    op.execute("ALTER TABLE translation_tasks DROP COLUMN IF EXISTS source_slice_object_key")
