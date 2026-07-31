"""
Per-school setting resolution.

Every school MAY configure its own calendar, Cal.com account, SMTP sender,
and outbound phone number (Schools admin page → per-school settings). A
school that hasn't set one of these falls back to the platform's global
Settings/env value, so existing schools (and the original single-tenant
deployment) keep working unchanged the moment this ships.

retell_api_key is deliberately NOT resolved here — it's an account-level
credential, not a per-school one; every school's (separate) Retell agent
still runs under the one configured Retell account.
"""
from typing import Optional
import os
from sqlalchemy.orm import Session
from src.db import Settings, School


def _global_setting(db: Session, key: str, env_key: str = None, default: str = None) -> Optional[str]:
    s = db.query(Settings).filter(Settings.key == key).first()
    if s and s.value:
        return s.value
    return os.getenv(env_key or key.upper(), default)


def get_school_for_contact(db: Session, contact) -> Optional[School]:
    """Resolves a contact's school row, or None (pre-multitenancy contact)."""
    if contact is None or not getattr(contact, "school_id", None):
        return None
    return db.query(School).filter(School.id == contact.school_id).first()


def get_retell_phone_number(db: Session, school: Optional[School]) -> str:
    if school and school.retell_phone_number:
        return school.retell_phone_number
    return _global_setting(db, "retell_phone_number", "RETELL_PHONE_NUMBER", "+18645812715")


def get_google_calendar_config(db: Session, school: Optional[School]) -> dict:
    """Returns {"credentials_json": str|None, "calendar_id": str|None}."""
    if school and school.google_calendar_credentials_json and school.google_calendar_id:
        return {
            "credentials_json": school.google_calendar_credentials_json,
            "calendar_id": school.google_calendar_id,
        }
    return {
        "credentials_json": _global_setting(db, "google_calendar_credentials_json", "GOOGLE_CALENDAR_CREDENTIALS_JSON"),
        "calendar_id": _global_setting(db, "google_calendar_id", "GOOGLE_CALENDAR_ID"),
    }


def get_cal_com_config(db: Session, school: Optional[School]) -> dict:
    """
    Returns {"api_key": str|None, "event_link": str|None}.

    There is deliberately NO hardcoded fallback credential here. A real
    `cal_live_...` key and its owner's personal booking link used to sit in
    this file as the default, which meant (a) a live secret was committed to
    the repo, and (b) any school without its own Cal.com account silently
    booked virtual meetings into that one personal calendar. With no key
    configured, cal_com.py already degrades gracefully — create_booking
    returns "Cal.com is not configured" and the appointment is still saved
    (just without a Cal Video link).
    """
    if school and school.cal_com_api_key:
        return {
            "api_key": school.cal_com_api_key,
            "event_link": school.cal_com_event_link or "",
            "virtual_event_slug": school.cal_com_virtual_event_slug or "",
            "in_person_event_slug": school.cal_com_in_person_event_slug or "",
        }
    return {
        "api_key": _global_setting(db, "cal_com_api_key", "CAL_COM_API_KEY"),
        "event_link": _global_setting(db, "cal_com_event_link", "CAL_COM_EVENT_LINK"),
        "virtual_event_slug": _global_setting(db, "cal_com_virtual_event_slug", "CAL_COM_VIRTUAL_EVENT_SLUG"),
        "in_person_event_slug": _global_setting(db, "cal_com_in_person_event_slug", "CAL_COM_IN_PERSON_EVENT_SLUG"),
    }


def cal_com_is_configured(db: Session, school: Optional[School]) -> bool:
    """
    Whether Cal.com can handle this school's bookings at all. Cal.com is the
    primary path for booking + calendar event + confirmation email; Google
    Calendar and SMTP are only used as a fallback for a school that has no
    Cal.com credentials, so this is the switch between the two.
    """
    return bool(get_cal_com_config(db, school)["api_key"])


def get_smtp_config(db: Session, school: Optional[School]) -> dict:
    """Returns {"server", "port", "username", "password", "from_email"}."""
    if school and school.smtp_server and school.smtp_username:
        return {
            "server": school.smtp_server,
            "port": school.smtp_port or 587,
            "username": school.smtp_username,
            "password": school.smtp_password,
            "from_email": school.smtp_from_email or school.smtp_username,
        }
    port_raw = _global_setting(db, "smtp_port", "SMTP_PORT")
    return {
        "server": _global_setting(db, "smtp_server", "SMTP_SERVER"),
        "port": int(port_raw) if port_raw else 587,
        "username": _global_setting(db, "smtp_username", "SMTP_USERNAME"),
        "password": _global_setting(db, "smtp_password", "SMTP_PASSWORD"),
        "from_email": _global_setting(db, "smtp_from_email", "SMTP_FROM_EMAIL"),
    }
