from datetime import datetime, timezone, timedelta

def get_ist_timezone() -> timezone:
    return timezone(timedelta(hours=5, minutes=30))

def is_working_hours(dt: datetime = None, start_hour: int = 9, end_hour: int = 16) -> bool:
    """
    Check if the given datetime is within working hours (default 09:00 - 16:00 IST / 4:00 PM).
    start_hour and end_hour can be overridden per school.
    If dt is None, checks the current time.
    """
    ist = get_ist_timezone()
    if dt is None:
        dt_ist = datetime.now(ist)
    else:
        # If dt has no timezone info (naive datetime), assume it is UTC
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        dt_ist = dt.astimezone(ist)
    
    return start_hour <= dt_ist.hour < end_hour


def next_working_day_start(start_hour: int = 9) -> datetime:
    """
    Returns a UTC datetime for the next working-day start in IST.
    Skips Sunday (weekday 6).  If today is Saturday (5), the next
    working day is Monday; if Sunday, also Monday.
    """
    ist = get_ist_timezone()
    now_ist = datetime.now(ist)
    
    # Start with tomorrow
    candidate = now_ist.replace(hour=start_hour, minute=0, second=0, microsecond=0) + timedelta(days=1)
    
    # Skip Sunday (weekday() == 6)
    while candidate.weekday() == 6:
        candidate += timedelta(days=1)
    
    # Convert back to UTC for storage
    return candidate.astimezone(timezone.utc).replace(tzinfo=None)
