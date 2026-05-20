"""add new field

Revision ID: 2a92e9eee3ca
Revises: d532ae1497c6
Create Date: 2025-07-20 20:33:38.278412

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '2a92e9eee3ca'
down_revision: Union[str, Sequence[str], None] = 'd532ae1497c6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    pass


def downgrade() -> None:
    """Downgrade schema."""
    pass
