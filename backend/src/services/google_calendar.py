import json
from datetime import datetime, timedelta
from google.oauth2 import service_account
from googleapiclient.discovery import build

SCOPES = ["https://www.googleapis.com/auth/calendar"]


def _get_service(credentials_json: str):
    info = json.loads(credentials_json)
    creds = service_account.Credentials.from_service_account_info(info, scopes=SCOPES)
    return build("calendar", "v3", credentials=creds, cache_discovery=False)


def create_event(
    credentials_json: str,
    calendar_id: str,
    start_iso: str,
    summary: str,
    description: str,
    attendee_name: str,
    attendee_phone: str,
    appointment_id: str,
    duration_minutes: int = 30,
    attendee_email: str = None,
) -> dict:
    """
    Creates the event and tags it with appointment_id via extendedProperties
    so the reconciliation job can match calendar changes back to the right DB row.
    """
    service = _get_service(credentials_json)
    # Handle timezone parsing correctly
    dt_str = start_iso
    if dt_str.endswith("Z"):
        dt_str = dt_str.replace("Z", "+00:00")
    start_dt = datetime.fromisoformat(dt_str)
    end_dt = start_dt + timedelta(minutes=duration_minutes)

    event = {
        "summary": summary,  # e.g. "TSRA Campus Visit — Siddhu Surineni"
        "description": f"{description}\nPhone: {attendee_phone}",
        "start": {"dateTime": start_dt.isoformat(), "timeZone": "Asia/Kolkata"},
        "end": {"dateTime": end_dt.isoformat(), "timeZone": "Asia/Kolkata"},
        "extendedProperties": {
            "private": {
                "aegis_appointment_id": str(appointment_id),
                "source": "aegis_calling_manager",
            }
        },
    }

    if attendee_email and attendee_email.strip():
        event["attendees"] = [
            {"email": attendee_email.strip(), "displayName": attendee_name}
        ]

    created = service.events().insert(
        calendarId=calendar_id, 
        body=event,
        sendUpdates="all"
    ).execute()
    return {
        "event_id": created["id"],
        "html_link": created.get("htmlLink"),  # deep link for "View in Google Calendar"
    }


def cancel_event(credentials_json: str, calendar_id: str, event_id: str) -> None:
    service = _get_service(credentials_json)
    service.events().delete(calendarId=calendar_id, eventId=event_id).execute()


def list_events_in_range(
    credentials_json: str, calendar_id: str, time_min_iso: str, time_max_iso: str
) -> list[dict]:
    """
    Used by the reconciliation job AND by the calendar page's month view —
    pulls live state from Google Calendar rather than only trusting the DB,
    so manual edits/cancellations made directly in Google Calendar are caught.
    """
    service = _get_service(credentials_json)
    result = service.events().list(
        calendarId=calendar_id,
        timeMin=time_min_iso,
        timeMax=time_max_iso,
        singleEvents=True,
        orderBy="startTime",
    ).execute()
    return result.get("items", [])
