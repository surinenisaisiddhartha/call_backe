from datetime import datetime, timedelta, timezone
from src.db import SessionLocal, Appointment, Contact, School
from src.services.google_calendar import list_events_in_range
from src.school_settings import get_google_calendar_config


def _sync_one_calendar(db, credentials_json: str, calendar_id: str, appointment_ids: set, label: str):
    """Reconciles Google Calendar against the given subset of appointment ids
    (a school's own calendar only ever contains that school's appointments,
    so this scoping also protects against cross-tenant event leakage)."""
    now = datetime.utcnow()
    time_min = (now - timedelta(days=1)).isoformat() + "Z"
    time_max = (now + timedelta(days=60)).isoformat() + "Z"

    events = list_events_in_range(
        credentials_json=credentials_json,
        calendar_id=calendar_id,
        time_min_iso=time_min,
        time_max_iso=time_max,
    )

    live_event_ids = set()
    for event in events:
        private_props = event.get("extendedProperties", {}).get("private", {})
        aegis_id = private_props.get("aegis_appointment_id")
        if not aegis_id or aegis_id not in appointment_ids:
            continue  # Not managed by us, or belongs to a different school's scope

        live_event_ids.add(aegis_id)
        appointment = db.query(Appointment).filter(Appointment.id == aegis_id).first()
        if not appointment:
            continue

        # 1. Reflect time updates made manually in Google Calendar
        event_start = event.get("start", {}).get("dateTime") or event.get("start", {}).get("date")
        if event_start:
            try:
                if event_start.endswith("Z"):
                    event_start_dt = datetime.fromisoformat(event_start.replace("Z", "+00:00")).astimezone(timezone.utc).replace(tzinfo=None)
                else:
                    event_start_dt = datetime.fromisoformat(event_start).astimezone(timezone.utc).replace(tzinfo=None)

                if appointment.scheduled_for != event_start_dt:
                    print(f"[SCHEDULER] ({label}) Rescheduling appointment {appointment.id} to match Google Calendar: {event_start_dt}")
                    appointment.scheduled_for = event_start_dt
            except Exception as ex:
                print(f"[SCHEDULER] ({label}) Error parsing event time: {ex}")

        # 2. Reflect manual deletions/cancellations
        if event.get("status") == "cancelled" and appointment.status != "Cancelled":
            print(f"[SCHEDULER] ({label}) Cancelling appointment {appointment.id} (cancelled in Google Calendar)")
            appointment.status = "Cancelled"

    # 3. Any local 'Booked' appointment in this scope whose event no longer
    # exists in this calendar = cancelled manually
    booked_appointments = db.query(Appointment).filter(
        Appointment.status == "Booked",
        Appointment.google_calendar_event_id.isnot(None),
        Appointment.id.in_(appointment_ids),
    ).all()

    for appt in booked_appointments:
        if appt.google_calendar_event_id and appt.id not in live_event_ids:
            print(f"[SCHEDULER] ({label}) Cancelling appointment {appt.id} (event not found in active events range)")
            appt.status = "Cancelled"


def sync_calendar_job():
    """
    Reconciles every calendar actually in use — the platform's shared/global
    calendar (for schools that haven't configured their own), plus each
    school's own calendar if it has one. Each pass is scoped to only the
    appointments that calendar is meant to hold, so a school's own calendar
    can never affect another school's appointments.
    """
    print("[SCHEDULER] Running Google Calendar reconciliation job...")
    db = SessionLocal()
    try:
        schools = db.query(School).all()
        schools_with_own_calendar = [
            s for s in schools if s.google_calendar_credentials_json and s.google_calendar_id
        ]
        school_ids_with_own_calendar = {s.id for s in schools_with_own_calendar}

        # Pass 1: each school's own calendar
        for school in schools_with_own_calendar:
            appointment_ids = {
                a.id for a in db.query(Appointment.id)
                .join(Contact, Appointment.contact_id == Contact.id)
                .filter(Contact.school_id == school.id)
            }
            if not appointment_ids:
                continue
            try:
                _sync_one_calendar(
                    db, school.google_calendar_credentials_json, school.google_calendar_id,
                    appointment_ids, label=school.name,
                )
            except Exception as e:
                print(f"[SCHEDULER] Google Calendar reconciliation failed for school '{school.name}': {e}")

        # Pass 2: the shared/global calendar, scoped to appointments whose
        # contact has no school, or whose school hasn't configured its own
        # calendar (this is the only pass that ran before per-school settings
        # existed, so it's what keeps every pre-existing deployment working).
        global_config = get_google_calendar_config(db, school=None)
        credentials_json = global_config["credentials_json"]
        calendar_id = global_config["calendar_id"]
        if credentials_json and calendar_id:
            global_query = db.query(Appointment.id).join(Contact, Appointment.contact_id == Contact.id)
            if school_ids_with_own_calendar:
                global_query = global_query.filter(
                    Contact.school_id.is_(None) | ~Contact.school_id.in_(school_ids_with_own_calendar)
                )
            global_appointment_ids = {a.id for a in global_query}
            if global_appointment_ids:
                _sync_one_calendar(db, credentials_json, calendar_id, global_appointment_ids, label="global")
        else:
            print("[SCHEDULER] Global Google Calendar credentials/id not set — skipping global-scope sync.")

        db.commit()
        print("[SCHEDULER] Google Calendar reconciliation complete.")
    except Exception as e:
        print(f"[SCHEDULER] Google Calendar reconciliation failed: {e}")
        db.rollback()
    finally:
        db.close()
