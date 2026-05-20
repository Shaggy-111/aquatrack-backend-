"""empty message

Revision ID: 2e3367a1cb43
Revises: 628cd1f5ccbc
Create Date: 2025-08-10 04:35:40.942870

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '2e3367a1cb43'
down_revision: Union[str, Sequence[str], None] = '628cd1f5ccbc'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    pass


def downgrade() -> None:
    """Downgrade schema."""
    pass
