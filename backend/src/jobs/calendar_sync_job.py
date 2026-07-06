from datetime import datetime, timedelta, timezone
import os
from src.db import SessionLocal, Appointment, Settings
from src.services.google_calendar import list_events_in_range

def sync_calendar_job():
    print("[SCHEDULER] Running Google Calendar reconciliation job...")
    db = SessionLocal()
    try:
        # Load Google Calendar settings
        settings_list = db.query(Settings).all()
        settings_map = {s.key: s.value for s in settings_list}
        credentials_json = settings_map.get("google_calendar_credentials_json") or os.getenv("GOOGLE_CALENDAR_CREDENTIALS_JSON")
        calendar_id = settings_map.get("google_calendar_id") or os.getenv("GOOGLE_CALENDAR_ID")
        
        if not credentials_json or not calendar_id:
            print("[SCHEDULER] Google Calendar Credentials or Calendar ID not set. Skipping sync.")
            return

        now = datetime.utcnow()
        # Events range: -1 day to +60 days
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
            if not aegis_id:
                continue  # Not managed by us
            
            live_event_ids.add(aegis_id)
            
            # Fetch appointment by UUID string
            appointment = db.query(Appointment).filter(Appointment.id == aegis_id).first()
            if not appointment:
                continue

            # 1. Reflect time updates made manually in Google Calendar
            event_start = event.get("start", {}).get("dateTime") or event.get("start", {}).get("date")
            if event_start:
                try:
                    # Clean Z/offset to naive UTC datetime
                    if event_start.endswith("Z"):
                        event_start_dt = datetime.fromisoformat(event_start.replace("Z", "+00:00")).astimezone(timezone.utc).replace(tzinfo=None)
                    else:
                        event_start_dt = datetime.fromisoformat(event_start).astimezone(timezone.utc).replace(tzinfo=None)
                    
                    if appointment.scheduled_for != event_start_dt:
                        print(f"[SCHEDULER] Rescheduling appointment {appointment.id} to match Google Calendar: {event_start_dt}")
                        appointment.scheduled_for = event_start_dt
                except Exception as ex:
                    print(f"[SCHEDULER] Error parsing event time: {ex}")

            # 2. Reflect manual deletions/cancellations
            if event.get("status") == "cancelled" and appointment.status != "Cancelled":
                print(f"[SCHEDULER] Cancelling appointment {appointment.id} (cancelled in Google Calendar)")
                appointment.status = "Cancelled"

        # 3. Any local 'Booked' appointment whose event no longer exists in Google Calendar = cancelled manually
        booked_appointments = db.query(Appointment).filter(
            Appointment.status == "Booked",
            Appointment.google_calendar_event_id.isnot(None)
        ).all()
        
        for appt in booked_appointments:
            if appt.google_calendar_event_id and appt.id not in live_event_ids:
                print(f"[SCHEDULER] Cancelling appointment {appt.id} (event not found in active events range)")
                appt.status = "Cancelled"

        db.commit()
        print("[SCHEDULER] Google Calendar reconciliation complete.")
    except Exception as e:
        print(f"[SCHEDULER] Google Calendar reconciliation failed: {e}")
        db.rollback()
    finally:
        db.close()
