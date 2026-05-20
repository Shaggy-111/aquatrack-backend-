"""Added status column to User

Revision ID: 7295abebf6e4
Revises: 7f0c40acefba
Create Date: 2025-07-25 15:22:17.815486
"""

from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '7295abebf6e4'
down_revision: Union[str, Sequence[str], None] = '7f0c40acefba'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

def upgrade():
    """Upgrade schema."""
    op.add_column('users', sa.Column('status', sa.String(), nullable=True))

def downgrade():
    """Downgrade schema."""
    op.drop_column('users', 'status')

