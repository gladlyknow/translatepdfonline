"""add translation_tasks.output_primary_path for PDF 404 fix

Worker writes the actual primary PDF path here on completion; API uses it
to serve /file instead of recomputing output_dir (avoids path mismatch).
"""

from __future__ import annotations

from alembic import op


revision = "20260304_0004"
down_revision = "20260304_0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE translation_tasks
        ADD COLUMN IF NOT EXISTS output_primary_path varchar(1024)
        """
    )


def downgrade() -> None:
    op.execute(
        """
        ALTER TABLE translation_tasks
        DROP COLUMN IF EXISTS output_primary_path
        """
    )
