"""add translation_tasks.preprocess_with_ocr for optional OCR before translate"""
from __future__ import annotations
from alembic import op

revision = "20260306_0008"
down_revision = "20260306_0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE translation_tasks ADD COLUMN IF NOT EXISTS preprocess_with_ocr boolean NOT NULL DEFAULT false"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE translation_tasks DROP COLUMN IF EXISTS preprocess_with_ocr")
