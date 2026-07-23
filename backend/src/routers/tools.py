"""
Retell AI Function Call Tools - Webhook endpoints for agent function calls.
"""

import os
import re
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Request, BackgroundTasks
from sqlalchemy.orm import Session
from pydantic import BaseModel, model_validator
from typing import Any, Optional
from src.db import get_db, Contact, ScheduledCallback, Appointment, CallAttempt, Settings
from src.knowledge import search_knowledge, smart_truncate

router = APIRouter(prefix="/api/webhooks/tools", tags=["Retell Tools"])


def verify_tools_secret(req: Request, db: Session = Depends(get_db)) -> None:
    """
    Soft-enforced shared-secret check for these Retell custom-function webhooks.
    These URLs are publicly reachable (ngrok/prod) and otherwise unauthenticated,
    so anyone who finds them could invoke book_appointment/schedule_callback/
    mark_outcome directly. If AEGIS_TOOLS_SECRET is configured (Settings key
    "aegis_tools_secret" or env var), the request must carry a matching
    X-Aegis-Tools-Secret header — set via setup_retell_agent.py's tool `headers`
    config. If no secret is configured yet, the check is skipped (with a
    warning) so existing unconfigured deployments keep working.
    """
    setting = db.query(Settings).filter(Settings.key == "aegis_tools_secret").first()
    expected = (setting.value if setting else None) or os.getenv("AEGIS_TOOLS_SECRET")
    if not expected:
        print("[TOOLS] WARNING: aegis_tools_secret not configured — tool webhook endpoints are unauthenticated. Set it in Settings to lock these down.")
        return
    provided = req.headers.get("x-aegis-tools-secret")
    if not provided or provided != expected:
        print("[TOOLS] Rejected tool call: missing or invalid X-Aegis-Tools-Secret header")
        raise HTTPException(status_code=401, detail="Invalid or missing tools secret")


class RetellToolBase(BaseModel):
    call_id: Optional[str] = None
    to_number: Optional[str] = None

    @model_validator(mode='before')
    @classmethod
    def extract_args(cls, data: Any) -> Any:
        if not isinstance(data, dict):
            return data
        merged = dict(data)
        # Retell nests the live-call info under a "call" object — the call_id
        # (and dialed number) live there, NOT at the top level. Pull them up so
        # resolve_contact's most reliable path (call_id -> CallAttempt -> contact)
        # actually works instead of falling through to fragile guesses.
        call = data.get("call")
        if isinstance(call, dict):
            if not merged.get("call_id"):
                merged["call_id"] = call.get("call_id")
            if not merged.get("to_number"):
                merged["to_number"] = call.get("to_number")
        # Also honour a call_id sent via retell_llm_dynamic_variables, if present.
        dv = data.get("retell_llm_dynamic_variables") or (call.get("retell_llm_dynamic_variables") if isinstance(call, dict) else None)
        if isinstance(dv, dict):
            if not merged.get("call_id") and dv.get("call_id"):
                merged["call_id"] = dv.get("call_id")
            if not merged.get("contact_id") and dv.get("contact_id"):
                merged["contact_id"] = dv.get("contact_id")
        # Flatten the tool arguments Retell passes under "args".
        if isinstance(data.get("args"), dict):
            merged.update(data["args"])
        return merged


class LookupRequest(RetellToolBase):
    query: str


class ScheduleCallbackRequest(RetellToolBase):
    datetime_iso: str
    reason: str = "requested callback"
    contact_id: str = None  # Optional, can be inferred from call context
    phone_number: str = None  # Optional, fallback


class BookAppointmentRequest(RetellToolBase):
    datetime_iso: str
    purpose: str
    attendee_name: str = ""   # Optional — backend already knows it from the contact
    attendee_phone: str = ""  # Optional — backend uses the dialed number / call_id
    attendee_email: str = ""  # Optional — collected during call if not pre-filled
    meeting_type: str = "in_person"  # "in_person" or "virtual" — caller's stated preference
    contact_id: str = None


class MarkOutcomeRequest(RetellToolBase):
    outcome: str  # interested_followup_scheduled, appointment_booked, not_interested, do_not_call, wrong_number, no_answer, undetermined
    notes: str = ""
    contact_id: str = None


@router.post("/lookup")
def lookup_school_info(
    request: LookupRequest,
    db: Session = Depends(get_db),
    _secret: None = Depends(verify_tools_secret)
):
    """
    Tool: lookup_school_info(query)
    Returns short grounded answer from TSRA knowledge base.
    Retell expects: {"result": "..."}  
    """
    if not request.query or len(request.query.strip()) < 3:
        return {"result": "I couldn't process that query. Please try asking about a specific topic like fees, curriculum, or admissions."}
    
    results = search_knowledge(request.query, limit=3)
    
    if results:
        combined_content = " ".join([r["content"] for r in results])
        answer = smart_truncate(combined_content, 600)
        return {"result": answer}
    else:
        return {"result": "I don't have that specific information right now. I'll make sure our admissions team follows up with the exact details."}


@router.get("/lookup")
def lookup_school_info_get(
    query: str,
    db: Session = Depends(get_db)
):
    """
    Tool: lookup_school_info(query) - GET version for testing
    Returns short grounded answer from TSRA knowledge base.
    """
    if not query or len(query.strip()) < 3:
        return {
            "success": False,
            "error": "Query must be at least 3 characters"
        }
    
    results = search_knowledge(query, limit=3)
    
    if results:
        # Synthesize answer from top results
        combined_content = " ".join([r["content"] for r in results])
        answer = smart_truncate(combined_content, 500)
        return {
            "success": True,
            "answer": answer,
            "sources": [r["source_url"] for r in results]
        }
    else:
        return {
            "success": True,
            "answer": "I don't have that specific information in my knowledge base. Let me have our admissions team follow up with the exact details.",
            "sources": []
        }


_EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")


def normalize_email(raw: str) -> str:
    """
    Speech-to-text on a spelled-out email often inserts stray hyphens between
    characters (caller says "two-zero-zero-three-A" and the transcript comes
    back as "2003-A-5201@gmail.com") — Cal.com's own email validator then
    rejects the local part as malformed even though the intended address is
    fine. If the raw email fails basic validation, retry once with hyphens
    stripped from the local part before giving up and returning it as-is.
    """
    raw = (raw or "").strip()
    if not raw or _EMAIL_RE.match(raw):
        return raw
    if "@" in raw:
        local, _, domain = raw.partition("@")
        cleaned = f"{local.replace('-', '')}@{domain}"
        if _EMAIL_RE.match(cleaned):
            return cleaned
    return raw


def resolve_contact(db: Session, req: Request, request_data: Any) -> Optional[Contact]:
    # 1. Try resolving via Retell call ID from JSON body / request data
    call_id = getattr(request_data, "call_id", None)
    if not call_id and req:
        # Fallback to headers
        call_id = req.headers.get("x-retell-call-id")

    if call_id:
        attempt = db.query(CallAttempt).filter(CallAttempt.retell_call_id == call_id).first()
        if attempt and attempt.contact:
            print(f"[TOOLS] Resolved contact {attempt.contact.id} from Retell Call ID: {call_id}")
            return attempt.contact

    # 2. Try resolving via contact_id parameter
    contact_id = getattr(request_data, "contact_id", None)
    if not contact_id and req:
        contact_id = req.query_params.get("contact_id")
    
    if contact_id and not (contact_id.startswith("{{") or contact_id.endswith("}}")):
        contact = db.query(Contact).filter(Contact.id == contact_id).first()
        if contact:
            print(f"[TOOLS] Resolved contact {contact.id} from contact_id parameter")
            return contact

    # 3. Try resolving via attendee_phone / phone_number. Callers speak their
    #    number as bare national digits ("6300130119"), but it is stored in
    #    E.164 form ("+916300130119"), so an exact string match fails and the
    #    booking wrongly reports "couldn't find contact". Compare on the last
    #    10 digits (the national number) after stripping all non-digits.
    phone = (getattr(request_data, "attendee_phone", None)
             or getattr(request_data, "phone_number", None)
             or getattr(request_data, "to_number", None))
    if phone:
        import re
        digits = re.sub(r"\D", "", phone)
        last10 = digits[-10:] if len(digits) >= 10 else digits
        if last10:
            contact = db.query(Contact).filter(Contact.phone_number == phone).first()
            if not contact:
                for cand in db.query(Contact).filter(Contact.phone_number.like(f"%{last10}")).all():
                    if re.sub(r"\D", "", cand.phone_number or "")[-10:] == last10:
                        contact = cand
                        break
            if contact:
                print(f"[TOOLS] Resolved contact {contact.id} from phone number: {phone} (matched last10={last10})")
                return contact

    # 3b. Try resolving via attendee_email — the agent confirms the email on
    #     every booking, so if it matches a stored contact, use that.
    email = getattr(request_data, "attendee_email", None)
    if email and email.strip():
        from sqlalchemy import func
        contact = db.query(Contact).filter(
            func.lower(Contact.email) == email.strip().lower()
        ).first()
        if contact:
            print(f"[TOOLS] Resolved contact {contact.id} from attendee_email: {email}")
            return contact

    # 4. Safe last-resort fallback. The dialer supports multiple concurrent
    #    calls, so guessing "the most recently updated contact" is only safe
    #    when there is exactly ONE plausible candidate — otherwise we risk
    #    attaching a booking/callback/outcome to the wrong lead. If it's
    #    ambiguous, refuse to guess and let the caller-facing tool respond
    #    gracefully instead of silently corrupting someone else's record.
    from datetime import timedelta
    calling_cutoff = datetime.utcnow() - timedelta(minutes=10)
    calling_candidates = db.query(Contact).filter(
        Contact.status == "Calling",
        Contact.updated_at >= calling_cutoff
    ).all()

    if len(calling_candidates) == 1:
        contact = calling_candidates[0]
        print(f"[TOOLS] Resolved contact {contact.id} ({contact.name}) via unambiguous single active-call fallback")
        return contact

    if len(calling_candidates) > 1:
        print(f"[TOOLS] resolve_contact: {len(calling_candidates)} contacts are simultaneously 'Calling' — refusing to guess to avoid cross-call mixup")
        return None

    # No contact currently "Calling" — this happens when mark_outcome fires
    # after book_appointment/schedule_callback already flipped the status
    # earlier in the same turn. Only guess if there's one unambiguous, very
    # recent (last 2 minutes) status change.
    recent_cutoff = datetime.utcnow() - timedelta(minutes=2)
    recent_candidates = db.query(Contact).filter(
        Contact.status.in_(["Scheduled", "Completed"]),
        Contact.updated_at >= recent_cutoff
    ).order_by(Contact.updated_at.desc()).all()

    if len(recent_candidates) == 1:
        contact = recent_candidates[0]
        print(f"[TOOLS] Resolved contact {contact.id} ({contact.name}) via unambiguous recent status-change fallback")
        return contact

    if len(recent_candidates) > 1:
        print(f"[TOOLS] resolve_contact: {len(recent_candidates)} contacts recently changed status — refusing to guess to avoid cross-call mixup")
    else:
        print(f"[TOOLS] resolve_contact: ALL resolution methods failed. call_id header={req.headers.get('x-retell-call-id') if req else None}")
    return None


@router.post("/schedule-callback")
def schedule_callback(
    request: ScheduleCallbackRequest,
    req: Request,
    db: Session = Depends(get_db),
    _secret: None = Depends(verify_tools_secret)
):
    """
    Tool: schedule_callback(datetime_iso, reason)
    Creates a scheduled callback for the contact.
    Returns Retell-compatible {"result": "..."}.
    """
    try:
        # Debug: log the raw request body to understand what Retell sends
        try:
            import asyncio
            body_bytes = asyncio.get_event_loop().run_until_complete(req.body()) if hasattr(req, '_body') else b""
        except Exception:
            body_bytes = b""
        print(f"[TOOLS] schedule_callback raw data: datetime_iso={request.datetime_iso!r}, reason={request.reason!r}, contact_id={request.contact_id!r}, phone={request.phone_number!r}")
        
        from datetime import timezone, timedelta
        dt_str = request.datetime_iso
        if dt_str.endswith("Z"):
            dt_str = dt_str.replace("Z", "+05:30")
        if "+" not in dt_str and (dt_str.count("-") < 3):
            dt_str = dt_str + "+05:30"
        dt = datetime.fromisoformat(dt_str)
        scheduled_for = dt.astimezone(timezone.utc).replace(tzinfo=None)
        readable_time = dt.strftime('%A, %d %B at %I:%M %p')

        # Guard: reject scheduling in the past or within 5 seconds
        # This catches cases where the agent uses current_datetime verbatim
        # instead of adding the requested duration offset.
        now_utc = datetime.utcnow()
        if scheduled_for <= now_utc + timedelta(seconds=5):
            print(f"[TOOLS] schedule_callback: datetime {scheduled_for} UTC is in the past/too soon (now={now_utc}). Rejecting so agent retries with correct future time.", flush=True)
            return {"result": f"Unable to schedule — the time {readable_time} is already past or too soon. Please add the requested duration to the current time and call this tool again with the correct future datetime."}

        contact = resolve_contact(db, req, request)
        if not contact:
            print("[TOOLS] schedule_callback: No contact found, cannot schedule")
            return {"result": "I couldn't schedule the callback because the contact details were missing. Please try again."}
            
        contact_id = contact.id
        
        # Check if there's already a pending ScheduledCallback for this contact
        existing = db.query(ScheduledCallback).filter(
            ScheduledCallback.contact_id == contact_id,
            ScheduledCallback.status == "Scheduled"
        ).first()
        if existing:
            # Update the existing one instead of creating a duplicate
            existing.scheduled_for = scheduled_for
            existing.reason = request.reason
            db.commit()
            return {"result": f"Callback successfully rescheduled for {readable_time}. We'll call you back then!"}
        
        # Create ScheduledCallback
        callback = ScheduledCallback(
            contact_id=contact_id,
            scheduled_for=scheduled_for,
            reason=request.reason,
            status="Scheduled",
            call_type="Follow-up"
        )
        db.add(callback)
        
        # Update contact status to Scheduled
        contact = db.query(Contact).filter(Contact.id == contact_id).first()
        if contact:
            contact.status = "Scheduled"
            contact.updated_at = datetime.utcnow()
        
        db.commit()
        
        # Register APScheduler one-shot job to fire the callback at the exact time
        try:
            from src.scheduler import get_scheduler
            from src.routers.webhooks import trigger_callback_call
            sched = get_scheduler()
            if sched and sched.running:
                sched.add_job(
                    trigger_callback_call,
                    "date",
                    run_date=scheduled_for,
                    args=[contact_id],
                    id=f"tool_cb_{contact_id}_{int(scheduled_for.timestamp())}",
                    replace_existing=True
                )
                print(f"[TOOLS] Registered APScheduler callback for {contact_id} at {scheduled_for} UTC")
        except Exception as sched_err:
            print(f"[TOOLS] APScheduler registration warning: {sched_err}")
        
        return {"result": f"Callback successfully scheduled for {readable_time}. We'll call you back then!"}
        
    except Exception as e:
        print(f"[TOOLS] schedule_callback error: {e}")
        import traceback
        traceback.print_exc()
        return {"result": f"There was an issue scheduling the callback: {str(e)}. Please confirm the time and try again."}


def process_appointment_booking_async(
    appointment_id: str,
    credentials_json: str,
    calendar_id: str,
    start_iso: str,
    summary: str,
    description: str,
    attendee_name: str,
    attendee_phone: str,
    attendee_email: str,
    smtp_server: str,
    smtp_port_val: int,
    smtp_username: str,
    smtp_password: str,
    smtp_from_email: str,
    readable_time: str,
    purpose: str,
    stale_calendar_event_id: str = None,
    meeting_type: str = "in_person",
    stale_calcom_booking_uid: str = None
):
    import asyncio
    from src.db import SessionLocal, Appointment
    from src.services.google_calendar import create_event, cancel_event
    from src.services.email_sender import send_booking_email
    from src import cal_com

    db = SessionLocal()
    gcal_html_link = None
    virtual_meeting_link = None
    try:
        if meeting_type == "virtual":
            if stale_calcom_booking_uid:
                try:
                    asyncio.run(cal_com.cancel_booking(db, stale_calcom_booking_uid, reason="Rescheduled"))
                    print(f"[BACKGROUND] Cancelled stale Cal.com booking: {stale_calcom_booking_uid}", flush=True)
                except Exception as cancel_err:
                    print(f"[BACKGROUND] Failed to cancel stale Cal.com booking {stale_calcom_booking_uid}: {cancel_err}", flush=True)
            try:
                cal_result = asyncio.run(cal_com.create_booking(
                    db=db,
                    contact_name=attendee_name,
                    contact_email=attendee_email or "guest@example.com",
                    start_time=start_iso
                ))
                if cal_result.get("success"):
                    virtual_meeting_link = cal_result.get("meeting_url")
                    appointment = db.query(Appointment).filter(Appointment.id == appointment_id).first()
                    if appointment:
                        appointment.calcom_booking_id = cal_result.get("uid")
                        appointment.virtual_meeting_link = virtual_meeting_link
                        db.commit()
                        print(f"[BACKGROUND] Cal.com virtual meeting booked: {virtual_meeting_link}", flush=True)
                else:
                    print(f"[BACKGROUND] Cal.com booking failed: {cal_result.get('error')}", flush=True)
            except Exception as cal_err:
                print(f"[BACKGROUND] Cal.com booking creation failed: {cal_err}", flush=True)

        if credentials_json and calendar_id:
            # Rebooking an existing appointment (see book_appointment) leaves the
            # previous Google Calendar event dangling since it points at a time
            # that's no longer valid — cancel it before creating the new one.
            if stale_calendar_event_id:
                try:
                    cancel_event(credentials_json, calendar_id, stale_calendar_event_id)
                    print(f"[BACKGROUND] Cancelled stale Google Calendar event: {stale_calendar_event_id}", flush=True)
                except Exception as cancel_err:
                    print(f"[BACKGROUND] Failed to cancel stale Google Calendar event {stale_calendar_event_id}: {cancel_err}", flush=True)
            try:
                result = create_event(
                    credentials_json=credentials_json,
                    calendar_id=calendar_id,
                    start_iso=start_iso,
                    summary=summary,
                    description=description,
                    attendee_name=attendee_name,
                    attendee_phone=attendee_phone,
                    appointment_id=appointment_id,
                    attendee_email=attendee_email
                )
                
                # Fetch appointment inside local db session and update GCal links
                appointment = db.query(Appointment).filter(Appointment.id == appointment_id).first()
                if appointment:
                    appointment.google_calendar_event_id = result["event_id"]
                    appointment.google_calendar_html_link = result["html_link"]
                    gcal_html_link = result["html_link"]
                    db.commit()
                    print(f"[BACKGROUND] Google Calendar event created: {result['event_id']}", flush=True)
            except Exception as gcal_err:
                print(f"[BACKGROUND] Google Calendar event creation failed: {gcal_err}", flush=True)

        # Dispatch booking confirmation email in the background
        if attendee_email and attendee_email.strip():
            try:
                send_booking_email(
                    smtp_server=smtp_server,
                    smtp_port=smtp_port_val,
                    username=smtp_username,
                    password=smtp_password,
                    from_email=smtp_from_email,
                    to_email=attendee_email.strip(),
                    attendee_name=attendee_name,
                    purpose=purpose,
                    scheduled_for_str=readable_time,
                    gcal_link=gcal_html_link,
                    virtual_meeting_link=virtual_meeting_link,
                    meeting_type=meeting_type
                )
            except Exception as email_err:
                print(f"[BACKGROUND] Email dispatch failed: {email_err}", flush=True)
    except Exception as e:
        print(f"[BACKGROUND] Error in process_appointment_booking_async: {e}", flush=True)
    finally:
        db.close()


@router.post("/book-appointment")
def book_appointment(
    request: BookAppointmentRequest,
    req: Request,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    _secret: None = Depends(verify_tools_secret)
):
    """
    Tool: book_appointment(datetime_iso, purpose, attendee_name, attendee_phone, attendee_email)
    Creates an appointment record instantly, then offloads calendar sync and email dispatch
    to a background task. This achieves zero latency/lag for the calling agent.
    """
    try:
        from datetime import timezone, timedelta
        dt_str = request.datetime_iso
        if dt_str.endswith("Z"):
            dt_str = dt_str.replace("Z", "+05:30")
        if "+" not in dt_str and (dt_str.count("-") < 3):
            dt_str = dt_str + "+05:30"
        dt = datetime.fromisoformat(dt_str)
        scheduled_for = dt.astimezone(timezone.utc).replace(tzinfo=None)
        readable_time = dt.strftime('%A, %d %B at %I:%M %p')
        
        contact = resolve_contact(db, req, request)
        if not contact:
            print("[TOOLS] book_appointment: No contact found")
            return {"result": "I couldn't find the contact details to book the appointment. Please try again."}

        # attendee_name/phone are optional from the agent now — fall back to the
        # resolved contact's own details so the calendar event and email are
        # still complete.
        attendee_name = (request.attendee_name or "").strip() or contact.name or "Guest"
        attendee_phone = (request.attendee_phone or "").strip() or contact.phone_number or ""

        # Save or update contact email — normalized to recover from common
        # speech-to-text artifacts (see normalize_email) before it's used
        # anywhere downstream (Cal.com, calendar invite, confirmation email).
        if request.attendee_email and request.attendee_email.strip():
            request.attendee_email = normalize_email(request.attendee_email)
            contact.email = request.attendee_email
            contact.updated_at = datetime.utcnow()

        # If the caller already has a Booked appointment (e.g. they change their
        # mind on the date mid-call, or the agent calls this tool twice), update
        # it in place instead of creating a duplicate row/calendar event/email —
        # mirrors the existing-callback check in schedule_callback above.
        existing_appointment = db.query(Appointment).filter(
            Appointment.contact_id == contact.id,
            Appointment.status == "Booked"
        ).first()

        meeting_type = (request.meeting_type or "in_person").strip().lower()
        if meeting_type not in ("in_person", "virtual"):
            meeting_type = "in_person"

        stale_calendar_event_id = None
        stale_calcom_booking_uid = None
        if existing_appointment:
            stale_calendar_event_id = existing_appointment.google_calendar_event_id
            stale_calcom_booking_uid = existing_appointment.calcom_booking_id
            existing_appointment.scheduled_for = scheduled_for
            existing_appointment.purpose = request.purpose
            existing_appointment.meeting_type = meeting_type
            existing_appointment.google_calendar_event_id = None
            existing_appointment.google_calendar_html_link = None
            existing_appointment.calcom_booking_id = None
            existing_appointment.virtual_meeting_link = None
            appointment = existing_appointment
        else:
            appointment = Appointment(
                contact_id=contact.id,
                scheduled_for=scheduled_for,
                purpose=request.purpose,
                meeting_type=meeting_type,
                status="Booked"
            )
            db.add(appointment)
            db.flush()  # Populates appointment.id

        contact.status = "Completed"
        db.commit()

        import os
        from src.db import Settings

        # Load credentials and configuration settings
        smtp_server = None
        smtp_port_val = 587
        smtp_username = None
        smtp_password = None
        smtp_from_email = None
        credentials_json = None
        calendar_id = None

        try:
            settings_list = db.query(Settings).all()
            settings_map = {s.key: s.value for s in settings_list}
            credentials_json = settings_map.get("google_calendar_credentials_json") or os.getenv("GOOGLE_CALENDAR_CREDENTIALS_JSON")
            calendar_id = settings_map.get("google_calendar_id") or os.getenv("GOOGLE_CALENDAR_ID")
            
            # Load SMTP settings for the background task
            smtp_server = settings_map.get("smtp_server") or os.getenv("SMTP_SERVER")
            smtp_port = settings_map.get("smtp_port") or os.getenv("SMTP_PORT")
            smtp_port_val = int(smtp_port) if smtp_port else 587
            smtp_username = settings_map.get("smtp_username") or os.getenv("SMTP_USERNAME")
            smtp_password = settings_map.get("smtp_password") or os.getenv("SMTP_PASSWORD")
            smtp_from_email = settings_map.get("smtp_from_email") or os.getenv("SMTP_FROM_EMAIL")
        except Exception as conf_err:
            print(f"[TOOLS] Failed to load background task settings: {conf_err}")

        # Enqueue both Google Calendar event creation and email confirmation to run in the background
        # This completely eliminates any lag/latency during the live phone call.
        background_tasks.add_task(
            process_appointment_booking_async,
            appointment_id=appointment.id,
            credentials_json=credentials_json,
            calendar_id=calendar_id,
            start_iso=dt.isoformat(),
            summary=f"TSRA {request.purpose} — {attendee_name}",
            description=f"Booked via Aegis voice calling agent. Purpose: {request.purpose}",
            attendee_name=attendee_name,
            attendee_phone=attendee_phone,
            attendee_email=(request.attendee_email or "").strip() or (contact.email or ""),
            smtp_server=smtp_server,
            smtp_port_val=smtp_port_val,
            smtp_username=smtp_username,
            smtp_password=smtp_password,
            smtp_from_email=smtp_from_email,
            readable_time=readable_time,
            purpose=request.purpose,
            stale_calendar_event_id=stale_calendar_event_id,
            meeting_type=meeting_type,
            stale_calcom_booking_uid=stale_calcom_booking_uid
        )

        if meeting_type == "virtual":
            return {"result": f"Your virtual meeting for {request.purpose} has been booked for {readable_time}. You'll receive the meeting link by email shortly. We look forward to speaking with you!"}
        return {"result": f"Your appointment for {request.purpose} has been booked for {readable_time}. You'll receive a confirmation shortly. We look forward to seeing you!"}
        
    except Exception as e:
        return {"result": f"There was an issue booking the appointment: {str(e)}. Please call us directly to confirm your slot."}



@router.post("/mark-outcome")
def mark_outcome(
    request: MarkOutcomeRequest,
    req: Request,
    db: Session = Depends(get_db),
    _secret: None = Depends(verify_tools_secret)
):
    """
    Tool: mark_outcome(outcome, notes)
    Marks the final outcome of a call and updates contact status.
    Returns Retell-compatible {"result": "..."}.
    """
    try:
        contact = resolve_contact(db, req, request)
        if not contact:
            return {"result": "Outcome recorded."}
        
        # Map outcome to contact status
        outcome_mapping = {
            "interested_followup_scheduled": "Scheduled",
            "appointment_booked": "Completed",
            "not_interested": "Completed",
            "do_not_call": "DoNotCall",
            "wrong_number": "Failed",
            "no_answer": "NeedsReschedule",
            "undetermined": "Pending"
        }
        
        contact.status = outcome_mapping.get(request.outcome, "Pending")
        contact.updated_at = datetime.utcnow()
        
        # Update the most recent CallAttempt with agent_outcome
        attempt = db.query(CallAttempt).filter(
            CallAttempt.contact_id == contact.id
        ).order_by(CallAttempt.started_at.desc()).first()
        
        if attempt:
            if attempt.summary:
                attempt.summary += f"\n\nAgent Outcome: {request.outcome}\nNotes: {request.notes}"
            else:
                attempt.summary = f"Agent Outcome: {request.outcome}\nNotes: {request.notes}"
        
        db.commit()
        return {"result": f"Call outcome recorded: {request.outcome}."}
        
    except Exception as e:
        return {"result": "Outcome recorded."}


@router.post("/end-call")
def end_call(
    req: Request,
    db: Session = Depends(get_db),
    _secret: None = Depends(verify_tools_secret)
):
    """
    Tool: end_call()
    Signals Retell to hang up the call immediately.
    Retell interprets a {"result": ...} response and then terminates the call
    when this custom function is marked as ending the call in the agent config.
    """
    call_id = req.headers.get("x-retell-call-id", "unknown")
    print(f"[TOOLS] end_call invoked for call_id={call_id}")
    return {"result": "Call ended. Goodbye!"}
