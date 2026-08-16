"""Central configuration for attendance calculations."""

from datetime import time, timedelta


OFFICE_START_TIME = time(hour=9, minute=0)
OFFICE_END_TIME = time(hour=18, minute=0)
GRACE_PERIOD = timedelta(minutes=15)
HALF_DAY_THRESHOLD_HOURS = 4.0
MINIMUM_WORKING_HOURS = 8.0

