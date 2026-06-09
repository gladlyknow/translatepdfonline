"""baseline revision for translatepdfonline

This revision marks the starting point for Alembic migrations.
Existing databases can be stamped with this revision.
"""

from __future__ import annotations

from alembic import op  # noqa: F401


revision = "20260304_0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Baseline: no-op. Use future revisions for schema changes.
    pass


def downgrade() -> None:
    # Baseline: no-op.
    pass

