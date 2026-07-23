import os
import httpx
from datetime import datetime, timedelta
from sqlalchemy.orm import Session
from src.db import Settings

CAL_BASE_URL = "https://api.cal.com/v2"
# Confirmed via direct testing against this account: different endpoints on
# Cal.com's current server require DIFFERENT cal-api-version values — there
# isn't one version that works everywhere.
#   GET  /v2/event-types -> 404 on 2024-08-13/2024-09-04, 200 on 2024-06-14
#   POST /v2/bookings    -> 400/500 (schema mismatch) on 2024-06-14, 201 on 2024-08-13
CAL_API_VERSION_EVENT_TYPES = "2024-06-14"
CAL_API_VERSION_BOOKINGS = "2024-08-13"

def get_cal_client_info(db: Session):
    api_key_setting = db.query(Settings).filter(Settings.key == "cal_com_api_key").first()
    event_link_setting = db.query(Settings).filter(Settings.key == "cal_com_event_link").first()

    api_key = api_key_setting.value if api_key_setting else os.getenv("CAL_COM_API_KEY", "cal_live_9872522039be685a1f90ad606ed57e60")
    event_link = event_link_setting.value if event_link_setting else os.getenv("CAL_COM_EVENT_LINK", "https://cal.com/sai-siddhartha-surineni-ai62cd")

    return api_key, event_link

def get_headers(api_key: str, api_version: str, extra: dict = None) -> dict:
    h = {
        "Authorization": f"Bearer {api_key}",
        "cal-api-version": api_version,
        "Content-Type": "application/json"
    }
    if extra:
        h.update(extra)
    return h

async def get_cal_event_type_id(db: Session) -> int:
    api_key, event_link = get_cal_client_info(db)
    if not api_key:
        print("Cal.com API key is not configured.")
        return None

    headers = get_headers(api_key, CAL_API_VERSION_EVENT_TYPES)

    async with httpx.AsyncClient() as client:
        try:
            res = await client.get(f"{CAL_BASE_URL}/event-types", headers=headers, timeout=30.0)
            print(f"[CAL] Event types status: {res.status_code}")
            if res.status_code == 200:
                data = res.json()
                # v2 returns {"status":"success","data":{"eventTypeGroups":[{"eventTypes":[...]}]}}
                # OR {"status":"success","data":[...]}
                raw_data = data.get("data", {})

                # Flatten event types from both possible shapes
                event_types = []
                if isinstance(raw_data, list):
                    event_types = raw_data
                elif isinstance(raw_data, dict):
                    for group in raw_data.get("eventTypeGroups", []):
                        event_types.extend(group.get("eventTypes", []))

                if event_types:
                    # Try to match slug from event link
                    # e.g. https://cal.com/username/30min -> slug "30min"
                    slug = None
                    link_parts = event_link.strip("/").split("/")
                    if len(link_parts) >= 5:
                        slug = link_parts[-1]

                    if slug:
                        for et in event_types:
                            if et.get("slug") == slug:
                                print(f"[CAL] Matched event type by slug '{slug}': id={et.get('id')}")
                                return et.get("id")

                    # Fallback: first event type
                    first_id = event_types[0].get("id")
                    print(f"[CAL] Using first event type: id={first_id}")
                    return first_id
                else:
                    print("[CAL] No event types found in account.")
            else:
                print("Failed to fetch Cal.com event types:", res.text)
        except Exception as e:
            print("Cal.com event type retrieval failed:", e)

    return None

async def get_available_slots(db: Session, start_time: str = None, end_time: str = None):
    api_key, event_link = get_cal_client_info(db)
    if not api_key:
        return get_mock_slots()

    event_type_id = await get_cal_event_type_id(db)
    if not event_type_id:
        print("No active event type found, returning fallback slots for UI testing.")
        return get_mock_slots()

    # Default range: next 7 days
    if not start_time:
        start_time = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%S") + "Z"
    if not end_time:
        end_time = (datetime.utcnow() + timedelta(days=7)).strftime("%Y-%m-%dT%H:%M:%S") + "Z"

    headers = get_headers(api_key, CAL_API_VERSION_EVENT_TYPES)
    params = {
        "eventTypeId": event_type_id,
        "startTime": start_time,
        "endTime": end_time,
        "timeZone": "Asia/Kolkata"
    }

    async with httpx.AsyncClient() as client:
        try:
            res = await client.get(f"{CAL_BASE_URL}/slots", headers=headers, params=params, timeout=15.0)
            print(f"[CAL] Slots status: {res.status_code}")
            if res.status_code == 200:
                return res.json()
            else:
                print("Failed to fetch slots from Cal.com API:", res.text)
                return get_mock_slots()
        except Exception as e:
            print("Error querying Cal.com slots:", e)
            return get_mock_slots()

async def create_booking(db: Session, contact_name: str, contact_email: str, start_time: str):
    """
    Creates a Cal.com booking on the account's Cal Video-enabled event type and
    returns a dict with the unique per-booking meeting link. Each booking gets
    its own Cal Video room (unlike a single static meeting link), so overlapping
    appointments never collide.

    Returns: {"success": bool, "uid": str, "meeting_url": str, "error": str|None}
    """
    api_key, _ = get_cal_client_info(db)
    event_type_id = await get_cal_event_type_id(db)

    if not api_key or not event_type_id:
        print("Skipping booking creation because Cal.com is not configured.")
        return {"success": False, "uid": None, "meeting_url": None, "error": "Cal.com is not configured"}

    headers = get_headers(api_key, CAL_API_VERSION_BOOKINGS)

    body = {
        "start": start_time,
        "attendee": {
            "name": contact_name,
            "email": contact_email,
            "timeZone": "Asia/Kolkata",
            "language": "en"
        },
        "eventTypeId": event_type_id,
    }

    async with httpx.AsyncClient() as client:
        try:
            # 15s was too tight in production: a real booking was confirmed
            # (createdAt) by Cal.com's server ~3s after we gave up waiting,
            # so the link was never saved even though the booking succeeded.
            # This runs in a background task with no caller waiting on it —
            # there's no latency cost to giving it real headroom.
            res = await client.post(f"{CAL_BASE_URL}/bookings", headers=headers, json=body, timeout=30.0)
            print(f"[CAL] Booking status: {res.status_code}")
            if res.status_code in [200, 201]:
                data = res.json().get("data", {})
                return {
                    "success": True,
                    "uid": data.get("uid"),
                    "meeting_url": data.get("meetingUrl") or data.get("location"),
                    "error": None
                }
            else:
                print("Failed to create booking on Cal.com:", res.text)
                return {"success": False, "uid": None, "meeting_url": None, "error": res.text}
        except httpx.TimeoutException as e:
            # Our request timed out, but Cal.com may have still completed the
            # booking server-side (exactly what happened in production once
            # already) — look it up before giving up on the link entirely.
            print(f"[CAL] Booking request timed out, checking if it went through anyway: {e}")
            recovered = await _find_recent_booking(client, headers, event_type_id, contact_email, start_time)
            if recovered:
                print(f"[CAL] Recovered booking after timeout: uid={recovered.get('uid')}")
                return {"success": True, "uid": recovered.get("uid"), "meeting_url": recovered.get("meetingUrl") or recovered.get("location"), "error": None}
            return {"success": False, "uid": None, "meeting_url": None, "error": str(e)}
        except Exception as e:
            print("Error creating Cal.com booking:", e)
            return {"success": False, "uid": None, "meeting_url": None, "error": str(e)}


async def _find_recent_booking(client: httpx.AsyncClient, headers: dict, event_type_id: int, attendee_email: str, start_time: str):
    """Looks up a booking by event type + attendee + start time — used to recover
    from a client-side timeout on POST /bookings that still succeeded server-side."""
    try:
        params = {
            "eventTypeId": event_type_id,
            "attendeeEmail": attendee_email,
            "afterStart": start_time,
        }
        res = await client.get(f"{CAL_BASE_URL}/bookings", headers=headers, params=params, timeout=15.0)
        if res.status_code == 200:
            bookings = res.json().get("data", [])
            for b in bookings:
                if b.get("start", "").startswith(start_time[:16]):  # match to the minute
                    return b
    except Exception as e:
        print(f"[CAL] Recovery lookup failed: {e}")
    return None


async def cancel_booking(db: Session, booking_uid: str, reason: str = "Rescheduled") -> bool:
    """Cancels a Cal.com booking by its string uid (NOT the numeric id)."""
    api_key, _ = get_cal_client_info(db)
    if not api_key or not booking_uid:
        return False

    headers = get_headers(api_key, CAL_API_VERSION_BOOKINGS)
    body = {"cancellationReason": reason}

    async with httpx.AsyncClient() as client:
        try:
            res = await client.post(f"{CAL_BASE_URL}/bookings/{booking_uid}/cancel", headers=headers, json=body, timeout=30.0)
            print(f"[CAL] Cancel status: {res.status_code}")
            return res.status_code in [200, 201]
        except Exception as e:
            print("Error cancelling Cal.com booking:", e)
            return False

def get_mock_slots():
    """Return mock slots for next 3 days to allow UI preview when Cal.com is not configured."""
    slots = {}
    today = datetime.utcnow()
    for day_offset in range(1, 4):
        date_str = (today + timedelta(days=day_offset)).strftime("%Y-%m-%d")
        slots[date_str] = [
            {"time": f"{date_str}T04:30:00Z"},   # 10:00 AM IST
            {"time": f"{date_str}T06:00:00Z"},   # 11:30 AM IST
            {"time": f"{date_str}T08:30:00Z"},   # 2:00 PM IST
            {"time": f"{date_str}T11:00:00Z"}    # 4:30 PM IST
        ]
    return {"data": {"slots": slots}}
