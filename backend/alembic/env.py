import os
import sys
from logging.config import fileConfig

from alembic import context
from sqlalchemy import engine_from_config, pool

# We are getting the path of the 'backend' directory, which is the parent
# of the 'alembic' directory. Then we add the parent of 'backend' to the
# Python path, so Python can find the 'backend' package and import from it.
current_dir = os.path.dirname(os.path.abspath(__file__))
backend_dir = os.path.dirname(current_dir)
project_root = os.path.dirname(backend_dir)
sys.path.append(project_root)

# Now, we can correctly import from the 'backend' package.
# The `models` folder is a package inside `backend`, so the import path is `backend.models`.
# If your models are in a file named `models.py` inside the `models` folder,
# the import is `from backend.models.models import Base`. Please adjust as needed.
from backend.models import Base

# This line reads the Alembic configuration from the alembic.ini file.
config = context.config

# This tells the logging module to load its configuration from the file
# specified in alembic.ini.
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# Set the target metadata. Alembic will use this to find all your tables.
target_metadata = Base.metadata

# This is the function that runs migrations offline.
def run_migrations_offline():
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )

    with context.begin_transaction():
        context.run_migrations()

# This is the function that runs migrations online.
def run_migrations_online():
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        context.configure(
            connection=connection, target_metadata=target_metadata
        )

        with context.begin_transaction():
            context.run_migrations()

if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
