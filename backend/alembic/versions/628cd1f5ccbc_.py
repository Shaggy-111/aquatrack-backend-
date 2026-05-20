"""empty message

Revision ID: 628cd1f5ccbc
Revises: 6b03d0b4bc33, eb8452f12dd8
Create Date: 2025-08-10 04:34:39.067015

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '628cd1f5ccbc'
down_revision: Union[str, Sequence[str], None] = ('6b03d0b4bc33', 'eb8452f12dd8')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    pass


def downgrade() -> None:
    """Downgrade schema."""
    pass
