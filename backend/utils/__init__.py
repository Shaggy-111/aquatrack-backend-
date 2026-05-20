# We use relative imports (with `..`) to reference modules
# in sibling directories, like `database` and `models`.

from ..database.db import Base, engine
from ..models import user
from ..models import region
from ..models import order  # optional

# This code will create all tables defined in the models
# when the application starts, which is a good practice.
Base.metadata.create_all(bind=engine)
print("✅ Tables created successfully.")
