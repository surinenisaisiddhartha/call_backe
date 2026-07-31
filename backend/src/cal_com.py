import os
import httpx
from datetime import datetime, timedelta
from sqlalchemy.orm import Session
from src.db import Settings, School

CAL_BASE_URL = "https://api.cal.com/v2"
# Confirmed via direct testing against this account: different endpoints on
# Cal.com's current server require DIFFERENT cal-api-version values — there
# isn't one version that works everywhere.
#   GET  /v2/event-types -> 404 on 2024-08-13/2024-09-04, 200 on 2024-06-14
#   POST /v2/bookings    -> 400/500 (schema mismatch) on 2024-06-14, 201 on 2024-08-13
#   GET  /v2/slots        -> 404 on 2024-06-14/2024-08-13, 200 on 2024-09-04,
#                            and it takes start/end (dates), NOT startTime/endTime
CAL_API_VERSION_EVENT_TYPES = "2024-06-14"
CAL_API_VERSION_BOOKINGS = "2024-08-13"
CAL_API_VERSION_SLOTS = "2024-09-04"

def get_cal_client_info(db: Session, school: School = None):
    """school=None uses the platform's global Cal.com account (unchanged
    default behavior); pass a School row to use its own Cal.com account if
    it has one configured, falling back to the global account otherwise."""
    from src.school_settings import get_cal_com_config
    config = get_cal_com_config(db, school)
    # Both may legitimately be unconfigured now that there is no hardcoded
    # fallback credential — normalize to "" so callers can do plain string
    # work (e.g. event_link.strip("/")) without a None check everywhere.
    return (config["api_key"] or ""), (config["event_link"] or "")


def _configured_slug(db: Session, school: School, meeting_type: str) -> str:
    """The event-type slug configured for this meeting kind, if any."""
    from src.school_settings import get_cal_com_config
    config = get_cal_com_config(db, school)
    key = "in_person_event_slug" if meeting_type == "in_person" else "virtual_event_slug"
    return (config.get(key) or "").strip()


def _fetch_event_types(api_key: str) -> list:
    """Flattened list of the account's event types, or [] on failure."""
    headers = get_headers(api_key, CAL_API_VERSION_EVENT_TYPES)
    try:
        res = httpx.get(f"{CAL_BASE_URL}/event-types", headers=headers, timeout=30.0)
        print(f"[CAL] Event types status: {res.status_code}")
        if res.status_code != 200:
            print("Failed to fetch Cal.com event types:", res.text)
            return []
        # v2 returns {"data":{"eventTypeGroups":[{"eventTypes":[...]}]}}
        # OR {"data":[...]}
        raw_data = res.json().get("data", {})
        if isinstance(raw_data, list):
            return raw_data
        event_types = []
        for group in raw_data.get("eventTypeGroups", []):
            event_types.extend(group.get("eventTypes", []))
        return event_types
    except Exception as e:
        print("Cal.com event type retrieval failed:", e)
        return []

def get_headers(api_key: str, api_version: str, extra: dict = None) -> dict:
    h = {
        "Authorization": f"Bearer {api_key}",
        "cal-api-version": api_version,
        "Content-Type": "application/json"
    }
    if extra:
        h.update(extra)
    return h

async def get_cal_event_type_id(db: Session, school: School = None, meeting_type: str = "virtual") -> int:
    """
    The Cal.com event type to book for this meeting kind.

    Resolution order:
      1. the slug explicitly configured for this meeting kind
      2. (virtual only) a slug embedded in cal_com_event_link, for back-compat
         with deployments that configured just a link
      3. the account's single event type, if it has exactly one

    Deliberately NO "just use the first event type" fallback: an account with
    both a Cal Video type and an in-person type would silently mail a campus
    visitor a video link, or hand a virtual attendee a street address. Better
    to book nothing and say so than to confirm the wrong kind of meeting.
    """
    api_key, event_link = get_cal_client_info(db, school)
    if not api_key:
        print("Cal.com API key is not configured.")
        return None

    event_types = _fetch_event_types(api_key)
    if not event_types:
        print("[CAL] No event types found in account.")
        return None

    wanted = _configured_slug(db, school, meeting_type)
    if not wanted and meeting_type != "in_person":
        # e.g. https://cal.com/username/30min -> slug "30min"
        link_parts = event_link.strip("/").split("/")
        if len(link_parts) >= 5:
            wanted = link_parts[-1]

    if wanted:
        for et in event_types:
            if et.get("slug") == wanted:
                print(f"[CAL] Matched {meeting_type} event type by slug '{wanted}': id={et.get('id')}")
                return et.get("id")
        print(f"[CAL] No event type with slug '{wanted}' for meeting_type={meeting_type} "
              f"(account has: {[et.get('slug') for et in event_types]})")
        return None

    if len(event_types) == 1:
        only = event_types[0]
        print(f"[CAL] Account has a single event type '{only.get('slug')}' — using it for {meeting_type}")
        return only.get("id")

    print(f"[CAL] {len(event_types)} event types exist but no slug is configured for "
          f"meeting_type={meeting_type} — refusing to guess. Set the "
          f"{'in-person' if meeting_type == 'in_person' else 'virtual'} event slug in this school's settings.")
    return None

async def get_available_slots(db: Session, start_time: str = None, end_time: str = None,
                              school: School = None, meeting_type: str = "virtual"):
    """
    Real availability for the event type behind this meeting kind.

    Note the API contract quirks, both of which previously made this silently
    return get_mock_slots() on every call: /v2/slots needs its own
    cal-api-version (2024-09-04), and it takes `start`/`end` as plain dates —
    the old startTime/endTime params 404'd.
    """
    api_key, event_link = get_cal_client_info(db, school)
    if not api_key:
        return get_mock_slots()

    event_type_id = await get_cal_event_type_id(db, school, meeting_type)
    if not event_type_id:
        print("No active event type found, returning fallback slots for UI testing.")
        return get_mock_slots()

    # Default range: next 7 days
    if not start_time:
        start_time = datetime.utcnow().strftime("%Y-%m-%d")
    if not end_time:
        end_time = (datetime.utcnow() + timedelta(days=7)).strftime("%Y-%m-%d")

    headers = get_headers(api_key, CAL_API_VERSION_SLOTS)
    params = {
        "eventTypeId": event_type_id,
        "start": start_time,
        "end": end_time,
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

async def create_booking(
    db: Session,
    contact_name: str,
    contact_email: str,
    start_time: str,
    school: School = None,
    meeting_type: str = "virtual",
    purpose: str = None,
    contact_phone: str = None,
):
    """
    Creates the Cal.com booking for an appointment. Cal.com is the primary path
    for the whole confirmation flow: it books the slot, writes the event to the
    calendar connected to the Cal.com account, and emails the attendee — so no
    separate Google Calendar insert or SMTP send is needed when this succeeds.

    meeting_type="virtual" books the Cal Video event type (each booking gets its
    own room, so overlapping appointments never collide); "in_person" books the
    address-located event type so the attendee is emailed the campus address
    rather than a video link.

    Returns: {"success": bool, "uid": str, "meeting_url": str, "error": str|None}
    """
    api_key, _ = get_cal_client_info(db, school)
    event_type_id = await get_cal_event_type_id(db, school, meeting_type)

    if not api_key or not event_type_id:
        print("Skipping booking creation because Cal.com is not configured.")
        return {"success": False, "uid": None, "meeting_url": None, "location": None,
                "error": "Cal.com is not configured"}

    headers = get_headers(api_key, CAL_API_VERSION_BOOKINGS)

    # Carried into the Cal.com booking so the confirmation email and the
    # calendar event say WHY the meeting exists, instead of just the event type
    # name. The app's own styled email used to carry this.
    notes_bits = []
    if purpose:
        notes_bits.append(f"Purpose: {purpose}")
    if contact_phone:
        notes_bits.append(f"Phone: {contact_phone}")
    if school is not None and getattr(school, "name", None):
        notes_bits.append(f"School: {school.name}")
    notes_bits.append("Booked by the admissions voice assistant.")
    notes = " | ".join(notes_bits)

    def build_body(email: str) -> dict:
        return {
            "start": start_time,
            "attendee": {
                "name": contact_name,
                "email": email,
                "timeZone": "Asia/Kolkata",
                "language": "en",
                **({"phoneNumber": contact_phone} if contact_phone else {}),
            },
            "eventTypeId": event_type_id,
            "bookingFieldsResponses": {"notes": notes},
            "metadata": {
                "source": "aegis-voice-agent",
                "meeting_type": meeting_type,
            },
        }

    async with httpx.AsyncClient() as client:
        try:
            # 15s was too tight in production: a real booking was confirmed
            # (createdAt) by Cal.com's server ~3s after we gave up waiting,
            # so the link was never saved even though the booking succeeded.
            # This runs in a background task with no caller waiting on it —
            # there's no latency cost to giving it real headroom.
            res = await client.post(f"{CAL_BASE_URL}/bookings", headers=headers, json=build_body(contact_email), timeout=30.0)
            print(f"[CAL] Booking status: {res.status_code}")

            if res.status_code not in [200, 201] and "email_validation_error" in res.text and "@" in contact_email:
                # Speech-to-text on a spelled-out email introduces stray
                # punctuation: hyphens between dictated characters ("two-
                # zero-zero-three-A" -> "2003-A-5201@..."), and a trailing
                # dot right before "@" from a mis-placed "dot gmail com"
                # (confirmed in production: "2003-A-5201.@gmail.com" — a
                # dot can't legally end a local part). Both look syntactically
                # plausible so we can't detect them up front — Cal.com's own
                # stricter validator rejecting it is the real signal. Retry
                # once with both artifacts cleaned up.
                local, _, domain = contact_email.partition("@")
                retry_email = f"{local.rstrip('.-_').replace('-', '')}@{domain}"
                if retry_email != contact_email:
                    print(f"[CAL] Email validation failed for '{contact_email}', retrying with '{retry_email}'")
                    res = await client.post(f"{CAL_BASE_URL}/bookings", headers=headers, json=build_body(retry_email), timeout=30.0)
                    print(f"[CAL] Retry booking status: {res.status_code}")

            if res.status_code in [200, 201]:
                data = res.json().get("data", {})
                return {
                    "success": True,
                    "uid": data.get("uid"),
                    # Only a virtual booking has a join URL. For in_person,
                    # Cal.com returns the street address in `location` — storing
                    # that as a "meeting link" would show an address where the
                    # dashboard renders a clickable join link.
                    "meeting_url": data.get("meetingUrl") if meeting_type == "virtual" else None,
                    "location": data.get("location"),
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
                return {
                    "success": True,
                    "uid": recovered.get("uid"),
                    "meeting_url": recovered.get("meetingUrl") if meeting_type == "virtual" else None,
                    "location": recovered.get("location"),
                    "error": None,
                }
            return {"success": False, "uid": None, "meeting_url": None, "location": None, "error": str(e)}
        except Exception as e:
            print("Error creating Cal.com booking:", e)
            return {"success": False, "uid": None, "meeting_url": None, "location": None, "error": str(e)}


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


async def cancel_booking(db: Session, booking_uid: str, reason: str = "Rescheduled", school: School = None) -> bool:
    """Cancels a Cal.com booking by its string uid (NOT the numeric id)."""
    api_key, _ = get_cal_client_info(db, school)
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
