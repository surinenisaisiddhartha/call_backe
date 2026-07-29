"""
Appointments Router - API endpoints for managing appointments.
"""

from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from src.db import get_db, Appointment, Contact
from src.routers.auth import get_current_user

router = APIRouter(prefix="/api/appointments", tags=["Appointments"])


def _guard_school(db: Session, appointment: Appointment, current_user: dict):
    """404 for appointments outside the school user's tenant."""
    sid = current_user.get("school_id")
    if not sid:
        return
    contact = db.query(Contact).filter(Contact.id == appointment.contact_id).first()
    if not contact or contact.school_id != sid:
        raise HTTPException(status_code=404, detail="Appointment not found")


class AppointmentCreate(BaseModel):
    contact_id: str
    scheduled_for: str  # ISO datetime
    purpose: str


class AppointmentUpdate(BaseModel):
    scheduled_for: str = None
    purpose: str = None
    status: str = None  # Booked, Cancelled, Completed


@router.get("")
def get_appointments(
    status: str = None,
    contact_id: str = None,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """Get all appointments with optional filters."""
    query = db.query(Appointment)
    if current_user.get("school_id"):
        query = query.join(Contact, Appointment.contact_id == Contact.id).filter(
            Contact.school_id == current_user["school_id"])
    
    if status:
        query = query.filter(Appointment.status == status)
    if contact_id:
        query = query.filter(Appointment.contact_id == contact_id)
    
    appointments = query.order_by(Appointment.scheduled_for.desc()).all()
    
    results = []
    for apt in appointments:
        contact = db.query(Contact).filter(Contact.id == apt.contact_id).first()
        results.append({
            "id": apt.id,
            "contact_id": apt.contact_id,
            "contact_name": contact.name if contact else "Unknown",
            "contact_phone": contact.phone_number if contact else "Unknown",
            "scheduled_for": apt.scheduled_for.isoformat() + "Z",
            "purpose": apt.purpose,
            "google_calendar_event_id": apt.google_calendar_event_id,
            "google_calendar_html_link": apt.google_calendar_html_link,
            "calcom_booking_id": apt.calcom_booking_id,
            "meeting_type": apt.meeting_type,
            "virtual_meeting_link": apt.virtual_meeting_link,
            "status": apt.status,
            "created_at": apt.created_at.isoformat()
        })
    
    return results


@router.get("/{id}")
def get_appointment(
    id: str,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """Get a specific appointment by ID."""
    appointment = db.query(Appointment).filter(Appointment.id == id).first()
    if not appointment:
        raise HTTPException(status_code=404, detail="Appointment not found")
    _guard_school(db, appointment, current_user)
    
    contact = db.query(Contact).filter(Contact.id == appointment.contact_id).first()
    
    return {
        "id": appointment.id,
        "contact_id": appointment.contact_id,
        "contact_name": contact.name if contact else "Unknown",
        "contact_phone": contact.phone_number if contact else "Unknown",
        "scheduled_for": appointment.scheduled_for.isoformat() + "Z",
        "purpose": appointment.purpose,
        "google_calendar_event_id": appointment.google_calendar_event_id,
        "google_calendar_html_link": appointment.google_calendar_html_link,
        "calcom_booking_id": appointment.calcom_booking_id,
        "meeting_type": appointment.meeting_type,
        "virtual_meeting_link": appointment.virtual_meeting_link,
        "status": appointment.status,
        "created_from_call_attempt_id": appointment.created_from_call_attempt_id,
        "created_at": appointment.created_at.isoformat()
    }


@router.post("")
def create_appointment(
    appointment: AppointmentCreate,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """Create a new appointment."""
    import os
    from src.db import Settings
    from src.services.google_calendar import create_event

    # Verify contact exists (and belongs to the caller's school)
    contact = db.query(Contact).filter(Contact.id == appointment.contact_id).first()
    if not contact:
        raise HTTPException(status_code=404, detail="Contact not found")
    if current_user.get("school_id") and contact.school_id != current_user["school_id"]:
        raise HTTPException(status_code=404, detail="Contact not found")
    
    # Parse datetime
    try:
        from datetime import timezone, timedelta
        ist_tz = timezone(timedelta(hours=5, minutes=30))
        dt_str = appointment.scheduled_for
        if "+" in dt_str or (dt_str.count("-") >= 3):
            dt = datetime.fromisoformat(dt_str)
        elif dt_str.endswith("Z"):
            dt = datetime.fromisoformat(dt_str.replace("Z", "+00:00"))
        else:
            if "T" in dt_str:
                parts = dt_str.split(":")
                if len(parts) == 2:
                    dt = datetime.strptime(dt_str, "%Y-%m-%dT%H:%M")
                elif len(parts) == 3:
                    dt = datetime.strptime(dt_str, "%Y-%m-%dT%H:%M:%S")
                else:
                    dt = datetime.fromisoformat(dt_str)
            else:
                dt = datetime.fromisoformat(dt_str)
            dt = dt.replace(tzinfo=ist_tz)
        scheduled_for = dt.astimezone(timezone.utc).replace(tzinfo=None)
    except:
        raise HTTPException(status_code=400, detail="Invalid datetime format")
    
    # Create appointment
    new_appointment = Appointment(
        contact_id=appointment.contact_id,
        scheduled_for=scheduled_for,
        purpose=appointment.purpose,
        status="Booked"
    )
    db.add(new_appointment)
    db.flush()
    
    # Update contact status
    contact.status = "Completed"
    
    # Sync with Google Calendar
    try:
        settings_list = db.query(Settings).all()
        settings_map = {s.key: s.value for s in settings_list}
        credentials_json = settings_map.get("google_calendar_credentials_json") or os.getenv("GOOGLE_CALENDAR_CREDENTIALS_JSON")
        calendar_id = settings_map.get("google_calendar_id") or os.getenv("GOOGLE_CALENDAR_ID")
        
        if credentials_json and calendar_id:
            result = create_event(
                credentials_json=credentials_json,
                calendar_id=calendar_id,
                start_iso=dt.isoformat(),
                summary=f"TSRA {appointment.purpose} — {contact.name}",
                description=f"Booked manually via Aegis Dashboard. Purpose: {appointment.purpose}",
                attendee_name=contact.name,
                attendee_phone=contact.phone_number,
                appointment_id=new_appointment.id,
            )
            new_appointment.google_calendar_event_id = result["event_id"]
            new_appointment.google_calendar_html_link = result["html_link"]
    except Exception as e:
        print(f"[GOOGLE CALENDAR] Manual booking sync failed: {e}")

    db.commit()
    db.refresh(new_appointment)
    
    return {
        "id": new_appointment.id,
        "scheduled_for": new_appointment.scheduled_for.isoformat() + "Z",
        "message": "Appointment created successfully"
    }


@router.patch("/{id}")
def update_appointment(
    id: str,
    update: AppointmentUpdate,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """Update an existing appointment."""
    import os
    from src.db import Settings
    from src.services.google_calendar import create_event, cancel_event

    appointment = db.query(Appointment).filter(Appointment.id == id).first()
    if not appointment:
        raise HTTPException(status_code=404, detail="Appointment not found")
    _guard_school(db, appointment, current_user)
    
    contact = db.query(Contact).filter(Contact.id == appointment.contact_id).first()
    
    old_event_id = appointment.google_calendar_event_id
    
    dt = None
    if update.scheduled_for:
        try:
            from datetime import timezone, timedelta
            ist_tz = timezone(timedelta(hours=5, minutes=30))
            dt_str = update.scheduled_for
            if "+" in dt_str or (dt_str.count("-") >= 3):
                dt = datetime.fromisoformat(dt_str)
            elif dt_str.endswith("Z"):
                dt = datetime.fromisoformat(dt_str.replace("Z", "+00:00"))
            else:
                if "T" in dt_str:
                    parts = dt_str.split(":")
                    if len(parts) == 2:
                        dt = datetime.strptime(dt_str, "%Y-%m-%dT%H:%M")
                    elif len(parts) == 3:
                        dt = datetime.strptime(dt_str, "%Y-%m-%dT%H:%M:%S")
                    else:
                        dt = datetime.fromisoformat(dt_str)
                else:
                    dt = datetime.fromisoformat(dt_str)
                dt = dt.replace(tzinfo=ist_tz)
            appointment.scheduled_for = dt.astimezone(timezone.utc).replace(tzinfo=None)
        except:
            raise HTTPException(status_code=400, detail="Invalid datetime format")
    
    if update.purpose:
        appointment.purpose = update.purpose
    
    if update.status:
        appointment.status = update.status
        
    db.commit()
    
    # Sync updates with Google Calendar
    try:
        settings_list = db.query(Settings).all()
        settings_map = {s.key: s.value for s in settings_list}
        credentials_json = settings_map.get("google_calendar_credentials_json") or os.getenv("GOOGLE_CALENDAR_CREDENTIALS_JSON")
        calendar_id = settings_map.get("google_calendar_id") or os.getenv("GOOGLE_CALENDAR_ID")
        
        if credentials_json and calendar_id:
            # 1. If cancelled, delete the calendar event
            if appointment.status == "Cancelled" and old_event_id:
                cancel_event(credentials_json, calendar_id, old_event_id)
                appointment.google_calendar_event_id = None
                appointment.google_calendar_html_link = None
            # 2. If rescheduled, cancel old and create new event to prevent drift
            elif update.scheduled_for and old_event_id:
                try:
                    cancel_event(credentials_json, calendar_id, old_event_id)
                except Exception as ex:
                    print(f"[GOOGLE CALENDAR] Cancel old event failed: {ex}")
                
                dt_iso = dt.isoformat() if dt else appointment.scheduled_for.isoformat() + "+00:00"
                result = create_event(
                    credentials_json=credentials_json,
                    calendar_id=calendar_id,
                    start_iso=dt_iso,
                    summary=f"TSRA {appointment.purpose} — {contact.name if contact else 'Unknown'}",
                    description=f"Rescheduled manually via Aegis Dashboard. Purpose: {appointment.purpose}",
                    attendee_name=contact.name if contact else "Unknown",
                    attendee_phone=contact.phone_number if contact else "Unknown",
                    appointment_id=appointment.id,
                )
                appointment.google_calendar_event_id = result["event_id"]
                appointment.google_calendar_html_link = result["html_link"]
            db.commit()
    except Exception as e:
        print(f"[GOOGLE CALENDAR] Reschedule/Update manual sync failed: {e}")
        
    return {
        "success": True,
        "message": "Appointment updated successfully"
    }


@router.delete("/{id}")
def delete_appointment(
    id: str,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """Delete an appointment."""
    import os
    from src.db import Settings
    from src.services.google_calendar import cancel_event

    appointment = db.query(Appointment).filter(Appointment.id == id).first()
    if not appointment:
        raise HTTPException(status_code=404, detail="Appointment not found")
    _guard_school(db, appointment, current_user)
    
    old_event_id = appointment.google_calendar_event_id
    
    db.delete(appointment)
    db.commit()
    
    # Sync deletion with Google Calendar
    try:
        settings_list = db.query(Settings).all()
        settings_map = {s.key: s.value for s in settings_list}
        credentials_json = settings_map.get("google_calendar_credentials_json") or os.getenv("GOOGLE_CALENDAR_CREDENTIALS_JSON")
        calendar_id = settings_map.get("google_calendar_id") or os.getenv("GOOGLE_CALENDAR_ID")
        
        if credentials_json and calendar_id and old_event_id:
            cancel_event(credentials_json, calendar_id, old_event_id)
    except Exception as e:
        print(f"[GOOGLE CALENDAR] Manual delete sync failed: {e}")
        
    return {
        "success": True,
        "message": "Appointment deleted successfully"
    }
