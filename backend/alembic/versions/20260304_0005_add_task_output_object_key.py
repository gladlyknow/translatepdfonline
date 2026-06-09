"""add translation_tasks.output_object_key for R2 translated PDF URL"""
from __future__ import annotations
from alembic import op
revision = "20260304_0005"
down_revision = "20260304_0004"
branch_labels = None
depends_on = None
def upgrade() -> None:
    op.execute("ALTER TABLE translation_tasks ADD COLUMN IF NOT EXISTS output_object_key varchar(512)")
def downgrade() -> None:
    op.execute("ALTER TABLE translation_tasks DROP COLUMN IF EXISTS output_object_key")
