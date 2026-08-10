from datetime import datetime, timezone, timedelta

def get_ist_timezone() -> timezone:
    return timezone(timedelta(hours=5, minutes=30))

def is_working_hours(dt: datetime = None) -> bool:
    """
    Check if the given datetime is within working hours (09:00 - 16:00 IST / 9 AM - 4 PM IST).
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
    
    return 9 <= dt_ist.hour < 16
