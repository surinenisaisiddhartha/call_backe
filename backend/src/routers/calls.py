import os
import time
import uuid
import json
from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks, Body
from sqlalchemy.orm import Session
from sqlalchemy import func
from src.db import get_db, Contact, Settings, UploadBatch, CallAttempt, School, ScheduledCallback
from src.routers.auth import get_current_user
from src.school_agent import get_school_agent_id
from src.school_settings import get_school_for_contact, get_retell_phone_number
from src.dialer import dialer
from src.events import event_manager
from src.utils import is_working_hours, next_working_day_start
from src.services.voice.provider_manager import provider_manager
from src.services.voice.models import OutboundCallRequest

router = APIRouter(prefix="/api/calls", tags=["Calling"])


@router.get("/concurrency")
async def get_concurrency(db: Session = Depends(get_db), current_user: dict = Depends(get_current_user)):
    """
    Returns structured concurrency metrics across active provider, school, and local dialer limits.
    """
    school_id = current_user.get("school_id")
    provider = provider_manager.get_provider(school_id=school_id)
    capabilities = provider.get_capabilities()

    s = db.query(Settings).filter(Settings.key == "concurrency_limit").first()
    school_limit = int((s.value if s else None) or os.getenv("MAX_CONCURRENT_CALLS", "15"))
    provider_limit = capabilities.max_concurrency or 20
    campaign_limit = min(school_limit, provider_limit)
    local_active = dialer.get_active_calls()

    return {
        "provider": provider.provider_name,
        "provider_limit": provider_limit,
        "provider_active": local_active,
        "school_limit": school_limit,
        "campaign_limit": campaign_limit,
        "effective_limit": campaign_limit,
        "local_active": local_active
    }


@router.post("/start-campaign")
async def start_campaign(
    payload: dict,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    batch_id = payload.get("batchId")
    contact_ids = payload.get("contactIds")
    school_id = current_user.get("school_id")

    if batch_id:
        q = db.query(Contact).filter(
            Contact.batch_id == batch_id,
            Contact.status.in_(["Pending", "NeedsReschedule", "Failed"])
        )
    elif contact_ids and isinstance(contact_ids, list):
        q = db.query(Contact).filter(Contact.id.in_(contact_ids))
    else:
        q = db.query(Contact).filter(
            Contact.status.in_(["Pending", "NeedsReschedule", "Failed"])
        )

    if school_id:
        q = q.filter(Contact.school_id == school_id)
    contacts_to_call = q.all()

    if not contacts_to_call:
        raise HTTPException(status_code=400, detail="No eligible contacts found to call")

    effective_batch_id = batch_id or f"manual_{int(time.time())}"
    cid_list = [c.id for c in contacts_to_call]

    background_tasks.add_task(_start_dialer_campaign, effective_batch_id, cid_list)

    event_manager.broadcast_sync(
        "CAMPAIGN_UPDATE",
        {"batch_id": effective_batch_id, "status": "running", "total_contacts": len(contacts_to_call)},
        school_id=school_id
    )

    concurrency_setting = db.query(Settings).filter(Settings.key == "concurrency_limit").first()
    concurrency_val = (concurrency_setting.value if concurrency_setting else None) or os.getenv('MAX_CONCURRENT_CALLS', '15')

    return {
        "success": True,
        "message": f"Campaign started for {len(contacts_to_call)} contacts (slot-based, up to {concurrency_val} concurrent)",
    }


def _start_dialer_campaign(batch_id: str, contact_ids: list):
    """Background helper that starts the CampaignDialer."""
    try:
        result = dialer.start(batch_id, contact_ids)
        print(f"[DIALER] Campaign {batch_id} started: {result}")
    except Exception as e:
        print(f"[DIALER] Error starting campaign: {e}")


@router.get("/campaign-status/{batch_id}")
async def get_campaign_status(
    batch_id: str,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """Return live dialer status + DB stats for a campaign."""
    live = dialer.get_status(batch_id)
    batch = db.query(UploadBatch).filter(UploadBatch.id == batch_id).first()
    if current_user.get("school_id") and batch and batch.school_id != current_user["school_id"]:
        raise HTTPException(status_code=404, detail="Campaign not found")

    status_counts = db.query(Contact.status, func.count(Contact.id)).filter(
        Contact.batch_id == batch_id
    ).group_by(Contact.status).all()
    counts = {s: c for s, c in status_counts}

    return {
        "batch_id": batch_id,
        "campaign_name": batch.file_name if batch else batch_id,
        "campaign_status": batch.status if batch else "unknown",
        **live,
        "db_stats": counts
    }


@router.post("/{contact_id}/call-now")
async def call_now(
    contact_id: str,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    contact = db.query(Contact).filter(Contact.id == contact_id).first()
    if not contact:
        raise HTTPException(status_code=404, detail="Contact not found")
    if current_user.get("school_id") and contact.school_id != current_user["school_id"]:
        raise HTTPException(status_code=404, detail="Contact not found")

    start_hour, end_hour = 9, 21
    if contact.school_id:
        school = db.query(School).filter(School.id == contact.school_id).first()
        if school:
            start_hour = school.calling_start_hour or 9
            end_hour = school.calling_end_hour or 21

    if not is_working_hours(start_hour=start_hour, end_hour=end_hour):
        retry_time = next_working_day_start(start_hour)
        existing = db.query(ScheduledCallback).filter(
            ScheduledCallback.contact_id == contact_id,
            ScheduledCallback.status == "Scheduled"
        ).first()
        if not existing:
            cb = ScheduledCallback(
                contact_id=contact_id,
                scheduled_for=retry_time,
                reason="Auto-scheduled: call-now attempted outside calling hours",
                status="Scheduled",
                call_type="Follow-up"
            )
            db.add(cb)
            db.commit()
        raise HTTPException(
            status_code=400,
            detail=f"Outside calling hours ({start_hour}:00–{end_hour}:00 IST). This call has been auto-scheduled for {retry_time.strftime('%Y-%m-%d %H:%M')} UTC."
        )

    if contact.status == "Calling":
        raise HTTPException(status_code=409, detail="This contact is already on an active call.")

    previous_status = contact.status
    contact.status = "Calling"
    contact.updated_at = datetime.utcnow()
    db.commit()

    try:
        school = get_school_for_contact(db, contact)
        agent_id = get_school_agent_id(db, contact) or "default_admission_agent"
        from_number = get_retell_phone_number(db, school)

        provider = provider_manager.get_provider(school_id=contact.school_id)

        school_name_val = school.name if school and school.name else "The Shri Ram Academy"
        school_loc_val = school.location if school and school.location else "Gachibowli, Hyderabad"
        school_phone_val = (school.contact_phone if school and school.contact_phone else None) or from_number or "+91 75698 91111"

        dynamic_vars = {
            "contact_id": contact_id,
            "caller_name": contact.name,
            "student_name": getattr(contact, "child_name", None) or contact.name,
            "grade_applying": getattr(contact, "grade_sought", None) or "Grade 5 (Primary Years)",
            "academic_year": getattr(contact, "academic_year", None) or "2026-2027",
            "school_name": school_name_val,
            "location": school_loc_val,
            "contact_phone": school_phone_val,
            "caller_email": contact.email or "",
            "notes": contact.notes or "",
            "booking_link": "https://cal.com/tsra-admissions/campus-tour",
            "campaign_name": f"Manual-Call-{contact_id[:8]}",
            "current_datetime": datetime.now(timezone(timedelta(hours=5, minutes=30))).replace(microsecond=0).isoformat()
        }

        call_request = OutboundCallRequest(
            to_number=contact.phone_number,
            from_number=from_number,
            agent_id=agent_id,
            contact_id=contact.id,
            school_id=contact.school_id,
            context=dynamic_vars,
            metadata={"contact_id": contact.id, "school_id": contact.school_id}
        )

        result = provider.create_call(call_request)
        call_id = result.provider_call_id

        attempt_count = db.query(CallAttempt).filter(CallAttempt.contact_id == contact_id).count()
        attempt = CallAttempt(
            contact_id=contact_id,
            provider=provider.provider_name,
            provider_call_id=call_id,
            provider_agent_id=agent_id,
            provider_status="initiated",
            internal_status="CALL_STARTED",
            retell_call_id=call_id,
            attempt_number=attempt_count + 1,
            started_at=datetime.utcnow(),
        )
        db.add(attempt)
        db.commit()

        dialer.register_active(call_id, contact_id)

        event_manager.broadcast_sync(
            "CALL_STARTED",
            {"contact_id": contact_id, "call_id": call_id, "status": "Calling", "provider": provider.provider_name},
            school_id=contact.school_id
        )

        return {
            "success": True,
            "message": f"Triggered call to {contact.name} via {provider.provider_name}",
            "provider": provider.provider_name,
            "call_id": call_id
        }
    except Exception as e:
        contact.status = previous_status
        contact.updated_at = datetime.utcnow()
        db.commit()
        raise HTTPException(status_code=400, detail=f"Failed to trigger call: {e}")


# ── INBOUND CALL HANDLING ──────────────────────────────────────────────────

@router.post("/inbound-webhook")
async def handle_inbound_call_webhook(
    payload: dict = Body(...),
    db: Session = Depends(get_db)
):
    """
    Telephony Webhook endpoint for receiving live incoming calls from parents (Retell, Twilio, Bolna, OmniDimension).
    - Matches or auto-creates lead record.
    - Resolves target school & persona prompt.
    - Registers inbound CallAttempt.
    - Broadcasts live INBOUND_CALL_RECEIVED event to CRM console.
    """
    try:
        from_num = payload.get("from_number") or payload.get("caller_number") or payload.get("from") or "+919876543210"
        to_num = payload.get("to_number") or payload.get("did") or payload.get("to")
        provider_name = (payload.get("provider") or "retell").lower()
        provider_call_id = payload.get("call_id") or payload.get("provider_call_id") or f"inbound_{int(time.time())}_{uuid.uuid4().hex[:6]}"

        # Resolve School by to_number or default
        school = None
        if to_num:
            school = db.query(School).filter(
                (School.contact_phone == to_num) | (School.retell_phone_number == to_num)
            ).first()
        if not school:
            school_id_param = payload.get("school_id")
            if school_id_param:
                school = db.query(School).filter(School.id == school_id_param).first()
        if not school:
            school = db.query(School).order_by(School.created_at.asc()).first()

        target_school_id = school.id if school else None

        # Lookup or Auto-Create Contact
        clean_phone = from_num.strip()
        contact = db.query(Contact).filter(Contact.phone_number == clean_phone).first()
        if not contact:
            display_name = f"Inbound Caller ({clean_phone[-4:] if len(clean_phone) >= 4 else clean_phone})"
            contact = Contact(
                id=str(uuid.uuid4()),
                name=display_name,
                phone_number=clean_phone,
                school_id=target_school_id,
                status="Calling",
                referral_source="Inbound AI Call",
                lead_classification="HOT",
                created_at=datetime.utcnow()
            )
            db.add(contact)
            db.commit()
            db.refresh(contact)
        else:
            contact.status = "Calling"
            contact.updated_at = datetime.utcnow()
            db.commit()

        # Load dynamic unified agent configuration for target school
        from src.routers.agent import get_default_unified_config
        agent_config = get_default_unified_config(db, school_id=target_school_id)

        school_name = school.name if school and school.name else "The Shri Ram Academy"
        school_loc = school.location if school and school.location else "Gachibowli, Hyderabad"
        school_phone = (school.contact_phone if school else None) or "+91 75698 91111"

        dynamic_vars = {
            "contact_id": contact.id,
            "caller_name": contact.name,
            "student_name": getattr(contact, "child_name", None) or contact.name,
            "grade_applying": getattr(contact, "grade_sought", None) or "Grade 5 (Primary Years)",
            "academic_year": getattr(contact, "academic_year", None) or "2026-2027",
            "school_name": school_name,
            "location": school_loc,
            "contact_phone": school_phone,
            "caller_email": contact.email or "",
            "notes": contact.notes or "",
            "booking_link": "https://cal.com/tsra-admissions/campus-tour",
            "current_datetime": datetime.now(timezone(timedelta(hours=5, minutes=30))).replace(microsecond=0).isoformat()
        }

        # Register inbound CallAttempt
        attempt_count = db.query(CallAttempt).filter(CallAttempt.contact_id == contact.id).count()
        
        attempt_kwargs = {
            "contact_id": contact.id,
            "provider": provider_name,
            "provider_call_id": provider_call_id,
            "provider_agent_id": payload.get("agent_id") or "inbound_admission_agent",
            "provider_status": "in_progress",
            "internal_status": "INBOUND_CALL_STARTED",
            "attempt_number": attempt_count + 1,
            "started_at": datetime.utcnow()
        }
        if hasattr(CallAttempt, 'direction'):
            attempt_kwargs["direction"] = "inbound"

        attempt = CallAttempt(**attempt_kwargs)
        db.add(attempt)
        db.commit()

        # Broadcast live SSE notification to frontend console
        event_manager.broadcast_sync(
            "INBOUND_CALL_RECEIVED",
            {
                "contact_id": contact.id,
                "contact_name": contact.name,
                "phone_number": contact.phone_number,
                "call_id": provider_call_id,
                "school_name": school_name,
                "provider": provider_name,
                "timestamp": datetime.now(timezone(timedelta(hours=5, minutes=30))).isoformat()
            },
            school_id=target_school_id
        )

        greeting = agent_config.get("general", {}).get("default_greeting", f"Hello! Welcome to {school_name} admissions desk. How can I help you today?")
        system_prompt = agent_config.get("prompt", {}).get("system_prompt", "")

        return {
            "success": True,
            "direction": "inbound",
            "call_id": provider_call_id,
            "contact_id": contact.id,
            "school_id": target_school_id,
            "agent_name": agent_config.get("general", {}).get("agent_name"),
            "greeting": greeting,
            "system_prompt": system_prompt,
            "dynamic_variables": dynamic_vars,
            "tools": agent_config.get("tools", [])
        }
    except Exception as err:
        print(f"[INBOUND WEBHOOK ERROR] {err}")
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Inbound call webhook failed: {str(err)}")


@router.post("/simulate-inbound")
async def simulate_inbound_call(
    payload: dict = Body(...),
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """
    Simulation Endpoint to test an Inbound Parent Call directly from the Console UI.
    """
    from_number = payload.get("from_number") or "+91 98765 43210"
    caller_name = payload.get("caller_name") or "Mrs. Anjali Mehta"
    target_school_id = payload.get("school_id") or current_user.get("school_id")

    school = None
    if target_school_id:
        school = db.query(School).filter(School.id == target_school_id).first()
    if not school:
        school = db.query(School).first()

    contact = db.query(Contact).filter(Contact.phone_number == from_number).first()
    if not contact:
        contact = Contact(
            id=str(uuid.uuid4()),
            name=caller_name,
            phone_number=from_number,
            school_id=school.id if school else None,
            status="Calling",
            referral_source="Inbound AI Simulation",
            lead_classification="HOT",
            created_at=datetime.utcnow()
        )
        db.add(contact)
        db.commit()
        db.refresh(contact)
    else:
        contact.name = caller_name
        contact.status = "Calling"
        contact.updated_at = datetime.utcnow()
        db.commit()

    sim_call_id = f"sim_inbound_{int(time.time())}_{uuid.uuid4().hex[:4]}"
    attempt_count = db.query(CallAttempt).filter(CallAttempt.contact_id == contact.id).count()

    attempt = CallAttempt(
        contact_id=contact.id,
        provider="simulation",
        provider_call_id=sim_call_id,
        provider_agent_id="sim_admission_agent",
        direction="inbound",
        provider_status="completed",
        internal_status="CALL_ANALYZED",
        attempt_number=attempt_count + 1,
        started_at=datetime.utcnow() - timedelta(seconds=165),
        ended_at=datetime.utcnow(),
        duration_sec=165.0,
        outcome="Answered",
        sentiment="Positive",
        transcript=f"Parent ({caller_name}): Hello! I'm interested in Grade 5 admission for my child. Could you share details about the fee structure and schedule a campus tour?\nAI Admission Assistant: Namaste Mrs. Mehta! I'd be delighted to assist. Our Grade 5 program follows the Cambridge PYP curriculum. Would you prefer a campus visit this Thursday at 10:30 AM or Friday at 2:00 PM?\nParent: Thursday 10:30 AM works perfectly for us.\nAI Assistant: Tour confirmed for Thursday 10:30 AM! I've sent the visitor pass to your phone.",
        summary=f"Inbound call from {caller_name} regarding Grade 5 admission. Inquired about Cambridge curriculum & fees. Booked campus tour for Thursday 10:30 AM.",
        analysis_json=json.dumps({
            "synopsis": f"Inbound enquiry for Grade 5. Parent interested in Cambridge curriculum.",
            "topics": ["Inbound Call", "Campus Visit", "Fee Structure"],
            "interest": "High",
            "next_step": "Campus Tour Confirmed"
        })
    )
    db.add(attempt)

    contact.status = "AppointmentBooked"
    contact.lead_score = 92.0
    contact.lead_classification = "HOT"
    contact.lead_scored_at = datetime.utcnow()
    db.commit()

    event_manager.broadcast_sync(
        "INBOUND_CALL_RECEIVED",
        {
            "contact_id": contact.id,
            "contact_name": contact.name,
            "phone_number": contact.phone_number,
            "call_id": sim_call_id,
            "school_name": school.name if school else "The Shri Ram Academy",
            "provider": "simulation",
            "timestamp": datetime.now(timezone(timedelta(hours=5, minutes=30))).isoformat()
        },
        school_id=school.id if school else None
    )

    return {
        "success": True,
        "message": f"Simulated Inbound Call from {caller_name} completed & qualified! 🎉",
        "call_id": sim_call_id,
        "contact_id": contact.id,
        "direction": "inbound",
        "lead_score": 92.0,
        "lead_classification": "HOT"
    }


@router.get("/inbound-logs")
async def get_inbound_call_logs(
    limit: int = 50,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """
    Returns itemized list of Inbound AI Parent Calls with transcript & score breakdowns.
    """
    school_id = current_user.get("school_id")
    query = db.query(CallAttempt, Contact, School)\
        .join(Contact, CallAttempt.contact_id == Contact.id)\
        .outerjoin(School, Contact.school_id == School.id)\
        .filter(CallAttempt.direction == "inbound")

    if school_id:
        query = query.filter(Contact.school_id == school_id)

    records = query.order_by(CallAttempt.started_at.desc()).limit(limit).all()

    return [
        {
            "id": attempt.id,
            "call_id": attempt.provider_call_id,
            "direction": "inbound",
            "caller_name": contact.name,
            "caller_phone": contact.phone_number,
            "school_name": school.name if school else "Platform Default",
            "provider": attempt.provider,
            "duration_sec": attempt.duration_sec or 0.0,
            "started_at": attempt.started_at.isoformat() if attempt.started_at else None,
            "outcome": attempt.outcome or "Completed",
            "sentiment": attempt.sentiment or "Positive",
            "transcript": attempt.transcript,
            "summary": attempt.summary,
            "lead_score": contact.lead_score or 85.0,
            "lead_classification": contact.lead_classification or "HOT"
        }
        for attempt, contact, school in records
    ]
