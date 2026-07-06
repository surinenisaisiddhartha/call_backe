import os
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from src.db import get_db, Contact, ScheduledCallback
from src.routers.auth import get_current_user
from src.routers.calls import make_retell_request

router = APIRouter(prefix="/api/schedule", tags=["Scheduling"])

def parse_iso_datetime(dt_str: str) -> datetime:
    try:
        from datetime import timezone, timedelta
        ist_tz = timezone(timedelta(hours=5, minutes=30))
        
        # If timezone offset is explicitly provided in the string (like +05:30)
        if "+" in dt_str or (dt_str.count("-") >= 3):
            dt = datetime.fromisoformat(dt_str)
            return dt.astimezone(timezone.utc).replace(tzinfo=None)
            
        if dt_str.endswith("Z"):
            return datetime.fromisoformat(dt_str.replace("Z", "+00:00")).astimezone(timezone.utc).replace(tzinfo=None)
            
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
            
        dt_ist = dt.replace(tzinfo=ist_tz)
        return dt_ist.astimezone(timezone.utc).replace(tzinfo=None)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid date format: {dt_str}. Use YYYY-MM-DDTHH:MM")

@router.post("")
async def schedule_callback(
    payload: dict,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    contact_id = payload.get("contactId")
    scheduled_for_str = payload.get("scheduledFor")
    call_type = payload.get("callType", "Follow-up")

    if not contact_id or not scheduled_for_str:
        raise HTTPException(status_code=400, detail="Missing contactId or scheduledFor")

    scheduled_for = parse_iso_datetime(scheduled_for_str)

    contact = db.query(Contact).filter(Contact.id == contact_id).first()
    if not contact:
        raise HTTPException(status_code=404, detail="Contact not found")

    # 1. Create Google Calendar Event
    calendar_event_id = None
    try:
        from src.db import Settings
        from src.services.google_calendar import create_event
        
        settings_list = db.query(Settings).all()
        settings_map = {s.key: s.value for s in settings_list}
        credentials_json = settings_map.get("google_calendar_credentials_json") or os.getenv("GOOGLE_CALENDAR_CREDENTIALS_JSON")
        calendar_id = settings_map.get("google_calendar_id") or os.getenv("GOOGLE_CALENDAR_ID")
        
        if credentials_json and calendar_id:
            result = create_event(
                credentials_json=credentials_json,
                calendar_id=calendar_id,
                start_iso=scheduled_for.isoformat() + "+00:00",
                summary=f"TSRA Callback — {contact.name}",
                description=f"Callback scheduled manually. Type: {call_type}",
                attendee_name=contact.name,
                attendee_phone=contact.phone_number,
                appointment_id=f"callback_{contact.id}",
            )
            calendar_event_id = result["event_id"]
    except Exception as e:
        print("Google Calendar callback insert error:", e)

    # 2. Call Retell Batch API with trigger_timestamp
    from_number = os.getenv("RETELL_PHONE_NUMBER", "+18645812715")
    trigger_timestamp = int(scheduled_for.timestamp() * 1000)

    retell_res = await make_retell_request("/create-batch-call", "POST", {
        "from_number": from_number,
        "name": f"Scheduled {call_type} - {contact.name}",
        "trigger_timestamp": trigger_timestamp,
        "tasks": [
            {
                "to_number": contact.phone_number,
                "retell_llm_dynamic_variables": {
                    "name": contact.name,
                    "notes": contact.notes or "",
                    "call_type": call_type
                }
            }
        ]
    })

    batch_call_id = retell_res.get("batch_call_id")

    # 3. Create Scheduled Callback Row
    callback = ScheduledCallback(
        contact_id=contact.id,
        scheduled_for=scheduled_for,
        google_calendar_event_id=calendar_event_id,
        status="Scheduled",
        batch_call_id=batch_call_id,
        call_type=call_type
    )
    db.add(callback)

    # Update Contact status to 'Scheduled'
    contact.status = "Scheduled"
    contact.updated_at = datetime.utcnow()
    
    db.commit()
    db.refresh(callback)

    return {
        "success": True,
        "callback": {
            "id": callback.id,
            "contact_id": callback.contact_id,
            "scheduled_for": callback.scheduled_for.isoformat() + "Z",
            "google_calendar_event_id": callback.google_calendar_event_id,
            "status": callback.status,
            "batch_call_id": callback.batch_call_id,
            "call_type": callback.call_type
        },
        "retellBatch": retell_res
    }

@router.get("")
def get_schedules(db: Session = Depends(get_db), current_user: dict = Depends(get_current_user)):
    schedules = db.query(ScheduledCallback).filter(ScheduledCallback.status == "Scheduled").all()
    
    # Map schedules to include contact details
    results = []
    for s in schedules:
        c = s.contact
        results.append({
            "id": s.id,
            "contact_id": s.contact_id,
            "contact_name": c.name,
            "contact_phone": c.phone_number,
            "contact_email": c.email,
            "scheduled_for": s.scheduled_for.isoformat() + "Z",
            "google_calendar_event_id": s.google_calendar_event_id,
            "status": s.status,
            "batch_call_id": s.batch_call_id,
            "call_type": s.call_type
        })
    return results

@router.put("/{id}")
async def reschedule_callback(
    id: str,
    payload: dict,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    scheduled_for_str = payload.get("scheduledFor")
    call_type = payload.get("callType")
    if not scheduled_for_str:
        raise HTTPException(status_code=400, detail="Missing scheduledFor")

    scheduled_for = parse_iso_datetime(scheduled_for_str)

    callback = db.query(ScheduledCallback).filter(ScheduledCallback.id == id).first()
    if not callback:
        raise HTTPException(status_code=404, detail="Scheduled callback not found")

    contact = callback.contact

    # Update call type if provided
    if call_type:
        callback.call_type = call_type

    # 1. Update Cal.com Booking (Not handled automatically here, webhook takes care of it usually if done via cal.com directly)

    # 2. Call Retell Batch API with new trigger_timestamp
    from_number = os.getenv("RETELL_PHONE_NUMBER", "+18645812715")
    trigger_timestamp = int(scheduled_for.timestamp() * 1000)

    retell_res = await make_retell_request("/create-batch-call", "POST", {
        "from_number": from_number,
        "name": f"Rescheduled {callback.call_type} - {contact.name}",
        "trigger_timestamp": trigger_timestamp,
        "tasks": [
            {
                "to_number": contact.phone_number,
                "retell_llm_dynamic_variables": {
                    "name": contact.name,
                    "notes": contact.notes or "",
                    "call_type": callback.call_type
                }
            }
        ]
    })

    # Update database record
    callback.scheduled_for = scheduled_for
    callback.batch_call_id = retell_res.get("batch_call_id")
    callback.created_at = datetime.utcnow()
    db.commit()

    return {
        "success": True,
        "callback": {
            "id": callback.id,
            "contact_id": callback.contact_id,
            "scheduled_for": callback.scheduled_for.isoformat() + "Z",
            "google_calendar_event_id": callback.google_calendar_event_id,
            "status": callback.status,
            "batch_call_id": callback.batch_call_id,
            "call_type": callback.call_type
        },
        "retellBatch": retell_res
    }

@router.delete("/{id}")
def cancel_callback(
    id: str,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    callback = db.query(ScheduledCallback).filter(ScheduledCallback.id == id).first()
    if not callback:
        raise HTTPException(status_code=404, detail="Scheduled callback not found")

    # Delete Calendar Event
    # No direct Cal.com delete handled right now (optional to add)

    # Update Callback status to Cancelled
    callback.status = "Cancelled"
    
    # Update Contact status back to NeedsReschedule
    contact = callback.contact
    contact.status = "NeedsReschedule"
    contact.updated_at = datetime.utcnow()

    db.commit()
    return {"success": True, "message": "Callback cancelled successfully"}
