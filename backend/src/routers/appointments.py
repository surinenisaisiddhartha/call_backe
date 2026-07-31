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
    # Decides which Cal.com event type is booked: the address-located campus
    # visit, or the Cal Video one. Defaults to in_person to match the model
    # default and the pre-existing behaviour of this endpoint.
    meeting_type: str = "in_person"


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
    meeting_type = (appointment.meeting_type or "in_person").strip().lower()
    if meeting_type not in ("in_person", "virtual"):
        meeting_type = "in_person"
    new_appointment = Appointment(
        contact_id=appointment.contact_id,
        scheduled_for=scheduled_for,
        purpose=appointment.purpose,
        meeting_type=meeting_type,
        status="Booked"
    )
    db.add(new_appointment)
    db.flush()
    
    # Update contact status
    contact.status = "Completed"
    
    # Cal.com is the primary path here too, so a booking made by staff in the
    # dashboard produces the same confirmation email and calendar event as one
    # booked by the voice agent. Google Calendar is the fallback for a school
    # with no Cal.com credentials.
    from src.school_settings import get_school_for_contact, get_google_calendar_config, cal_com_is_configured
    school = get_school_for_contact(db, contact)
    cal_com_handled = False
    if cal_com_is_configured(db, school):
        try:
            import asyncio
            from src import cal_com
            cal_result = asyncio.run(cal_com.create_booking(
                db=db,
                contact_name=contact.name,
                contact_email=contact.email or "guest@example.com",
                start_time=dt.isoformat(),
                school=school,
                meeting_type=meeting_type,
                purpose=appointment.purpose,
                contact_phone=contact.phone_number,
            ))
            if cal_result.get("success"):
                cal_com_handled = True
                new_appointment.calcom_booking_id = cal_result.get("uid")
                new_appointment.virtual_meeting_link = cal_result.get("meeting_url")
                print(f"[CAL.COM] Manual booking created: uid={cal_result.get('uid')}")
            else:
                print(f"[CAL.COM] Manual booking failed ({cal_result.get('error')}) — falling back to Google Calendar")
        except Exception as e:
            print(f"[CAL.COM] Manual booking failed: {e} — falling back to Google Calendar")

    try:
        gcal_config = get_google_calendar_config(db, school)
        credentials_json = gcal_config["credentials_json"]
        calendar_id = gcal_config["calendar_id"]

        if not cal_com_handled and credentials_json and calendar_id:
            result = create_event(
                credentials_json=credentials_json,
                calendar_id=calendar_id,
                start_iso=dt.isoformat(),
                summary=f"{school.name if school else 'TSRA'} {appointment.purpose} — {contact.name}",
                description=f"Booked manually via EnquiryCall. Purpose: {appointment.purpose}",
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

    from src.school_settings import get_school_for_contact, get_google_calendar_config
    school = get_school_for_contact(db, contact) if contact else None

    # ── Cal.com first: it owns the attendee-facing side of the booking ──────
    # Cancelling here is what actually frees the slot and emails the attendee a
    # cancellation; a reschedule is a cancel + rebook so Cal.com re-sends the
    # confirmation with the new time (and a fresh Cal Video room for virtual).
    cal_com_handled = False
    old_calcom_uid = appointment.calcom_booking_id
    if old_calcom_uid:
        try:
            import asyncio
            from src import cal_com
            if appointment.status == "Cancelled":
                asyncio.run(cal_com.cancel_booking(db, old_calcom_uid, reason="Cancelled via dashboard", school=school))
                appointment.calcom_booking_id = None
                appointment.virtual_meeting_link = None
                cal_com_handled = True
                print(f"[CAL.COM] Cancelled booking {old_calcom_uid}")
            elif update.scheduled_for:
                asyncio.run(cal_com.cancel_booking(db, old_calcom_uid, reason="Rescheduled via dashboard", school=school))
                dt_iso = dt.isoformat() if dt else appointment.scheduled_for.isoformat() + "+00:00"
                cal_result = asyncio.run(cal_com.create_booking(
                    db=db,
                    contact_name=contact.name if contact else "Guest",
                    contact_email=(contact.email if contact else None) or "guest@example.com",
                    start_time=dt_iso,
                    school=school,
                    meeting_type=appointment.meeting_type or "in_person",
                    purpose=appointment.purpose,
                    contact_phone=contact.phone_number if contact else None,
                ))
                if cal_result.get("success"):
                    appointment.calcom_booking_id = cal_result.get("uid")
                    appointment.virtual_meeting_link = cal_result.get("meeting_url")
                    cal_com_handled = True
                    print(f"[CAL.COM] Rebooked as {cal_result.get('uid')} for {dt_iso}")
                else:
                    print(f"[CAL.COM] Rebooking failed: {cal_result.get('error')}")
            db.commit()
        except Exception as e:
            print(f"[CAL.COM] Reschedule/cancel sync failed: {e}")
            db.rollback()

    # Sync updates with Google Calendar — only for appointments Cal.com isn't
    # managing (i.e. booked under the fallback path).
    try:
        gcal_config = get_google_calendar_config(db, school)
        credentials_json = gcal_config["credentials_json"]
        calendar_id = gcal_config["calendar_id"]

        if not cal_com_handled and credentials_json and calendar_id:
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
                    summary=f"{school.name if school else 'TSRA'} {appointment.purpose} — {contact.name if contact else 'Unknown'}",
                    description=f"Rescheduled manually via EnquiryCall. Purpose: {appointment.purpose}",
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
    from src.services.google_calendar import cancel_event
    from src.school_settings import get_school_for_contact, get_google_calendar_config

    appointment = db.query(Appointment).filter(Appointment.id == id).first()
    if not appointment:
        raise HTTPException(status_code=404, detail="Appointment not found")
    _guard_school(db, appointment, current_user)

    old_event_id = appointment.google_calendar_event_id
    old_calcom_uid = appointment.calcom_booking_id
    contact = db.query(Contact).filter(Contact.id == appointment.contact_id).first()
    school = get_school_for_contact(db, contact) if contact else None

    db.delete(appointment)
    db.commit()

    # Cancel the Cal.com booking so the slot is freed and the attendee is told
    # — deleting only our own row would leave the booking live on Cal.com and
    # the attendee still expecting the meeting.
    if old_calcom_uid:
        try:
            import asyncio
            from src import cal_com
            asyncio.run(cal_com.cancel_booking(db, old_calcom_uid, reason="Deleted via dashboard", school=school))
            print(f"[CAL.COM] Cancelled booking {old_calcom_uid} for deleted appointment")
        except Exception as e:
            print(f"[CAL.COM] Delete sync failed: {e}")

    # Sync deletion with Google Calendar (this contact's school's calendar
    # if it has one, else the shared platform calendar)
    try:
        gcal_config = get_google_calendar_config(db, school)
        credentials_json = gcal_config["credentials_json"]
        calendar_id = gcal_config["calendar_id"]

        if credentials_json and calendar_id and old_event_id:
            cancel_event(credentials_json, calendar_id, old_event_id)
    except Exception as e:
        print(f"[GOOGLE CALENDAR] Manual delete sync failed: {e}")
        
    return {
        "success": True,
        "message": "Appointment deleted successfully"
    }
