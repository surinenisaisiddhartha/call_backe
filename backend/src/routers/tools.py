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
from src.events import event_manager

router = APIRouter(prefix="/api/webhooks/tools", tags=["Retell Tools"])


def verify_tools_secret(req: Request, db: Session = Depends(get_db)) -> None:
    """
    Shared-secret check for admission tool webhooks.
    Validates X-Admission-Tools-Secret or X-Aegis-Tools-Secret header.
    """
    from src.cache import settings_cache

    def _load_secret():
        s = db.query(Settings).filter(Settings.key.in_(["admission_tools_secret", "aegis_tools_secret"])).first()
        return s.value if s else None

    expected = (
        settings_cache.get_or_load("admission_tools_secret", _load_secret)
        or os.getenv("ADMISSION_TOOLS_SECRET")
        or os.getenv("AEGIS_TOOLS_SECRET")
    )
    if not expected:
        return
    provided = req.headers.get("x-admission-tools-secret") or req.headers.get("x-aegis-tools-secret")
    if not provided or provided != expected:
        print("[TOOLS] Rejected tool call: missing or invalid X-Admission-Tools-Secret header")
        raise HTTPException(status_code=401, detail="Invalid or missing tools secret")


class AdmissionToolBase(BaseModel):
    call_id: Optional[str] = None
    provider_call_id: Optional[str] = None
    internal_call_id: Optional[str] = None
    provider: Optional[str] = None
    to_number: Optional[str] = None
    agent_id: Optional[str] = None
    contact_id: Optional[str] = None

    @model_validator(mode='before')
    @classmethod
    def extract_args(cls, data: Any) -> Any:
        if not isinstance(data, dict):
            return data
        merged = dict(data)
        call = data.get("call")
        if isinstance(call, dict):
            if not merged.get("call_id"):
                merged["call_id"] = call.get("call_id")
            if not merged.get("provider_call_id"):
                merged["provider_call_id"] = call.get("call_id") or call.get("provider_call_id")
            if not merged.get("to_number"):
                merged["to_number"] = call.get("to_number")
            if not merged.get("agent_id"):
                merged["agent_id"] = call.get("agent_id")
        dv = data.get("retell_llm_dynamic_variables") or (call.get("retell_llm_dynamic_variables") if isinstance(call, dict) else None)
        if isinstance(dv, dict):
            if not merged.get("call_id") and dv.get("call_id"):
                merged["call_id"] = dv.get("call_id")
            if not merged.get("contact_id") and dv.get("contact_id"):
                merged["contact_id"] = dv.get("contact_id")
            if not merged.get("internal_call_id") and dv.get("internal_call_id"):
                merged["internal_call_id"] = dv.get("internal_call_id")
        if isinstance(data.get("args"), dict):
            merged.update(data["args"])
        if isinstance(data.get("arguments"), dict):
            merged.update(data["arguments"])
        return merged


RetellToolBase = AdmissionToolBase


class LookupRequest(RetellToolBase):
    query: str


class ScheduleCallbackRequest(RetellToolBase):
    datetime_iso: str
    reason: str = "requested callback"
    followup_type: str = "ai_callback"  # "ai_callback", "counselor_callback", "counselor_task"
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


class BookClassRequest(RetellToolBase):
    student_name: str
    grade_sought: str = ""
    class_type: str  # "Early Years Trial", "STEM Robotics Workshop", "Cambridge IB Trial"
    datetime_iso: str
    contact_id: str = None


class SaveProfileRequest(RetellToolBase):
    """
    Every profile field arrives as an optional extra — the agent sends only
    what it just learned, so the model deliberately declares none of them and
    they are read off the raw payload instead. Declaring twenty Optional[str]
    fields here would duplicate profile.py and drift from it.
    """
    model_config = {"extra": "allow"}
    contact_id: str = None


class MarkOutcomeRequest(RetellToolBase):
    outcome: str  # interested_followup_scheduled, appointment_booked, not_interested, do_not_call, wrong_number, no_answer, undetermined
    notes: str = ""
    contact_id: str = None


@router.post("/lookup")
def lookup_school_info(
    request: LookupRequest,
    req: Request,
    db: Session = Depends(get_db),
    _secret: None = Depends(verify_tools_secret)
):
    """
    Tool: lookup_school_info(query)
    Returns a short grounded answer from the CALLING school's knowledge base.
    Retell expects: {"result": "..."}
    """
    if not request.query or len(request.query.strip()) < 3:
        return {"result": "I couldn't process that query. Please try asking about a specific topic like fees, curriculum, or admissions."}

    # Scope the lookup to the school whose agent is on this call. Without this,
    # every school's agent answered from the original school's website content
    # — i.e. confidently stating another school's fees and admission status.
    school_id = resolve_calling_school_id(db, req, request)
    results = search_knowledge(request.query, limit=3, school_id=school_id)

    if results:
        combined_content = " ".join([r["content"] for r in results])
        answer = smart_truncate(combined_content, 600)
        return {"result": answer}
    else:
        return {"result": "I don't have that specific information right now. I'll make sure our admissions team follows up with the exact details."}


@router.get("/lookup")
def lookup_school_info_get(
    query: str,
    school_id: str = None,
    db: Session = Depends(get_db),
    _secret: None = Depends(verify_tools_secret)
):
    """
    Tool: lookup_school_info(query) — GET version, for manually testing what
    the agent would find. Nothing in the app calls this (Retell is wired to the
    POST route), but it is publicly reachable, so it takes the same shared
    secret as the real tool routes and requires an explicit school_id rather
    than searching every tenant's knowledge base at once.
    """
    if not query or len(query.strip()) < 3:
        return {
            "success": False,
            "error": "Query must be at least 3 characters"
        }

    results = search_knowledge(query, limit=3, school_id=school_id)

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


def resolve_calling_school_id(db: Session, req: Request, request_data: Any) -> Optional[str]:
    """
    Which tenant this tool call belongs to, derived from the Retell agent that
    placed the call — each school has its own dedicated agent, so the agent id
    is an authoritative tenant identifier that the caller can't influence.

    Returns None when the agent can't be mapped to a school (the shared
    pre-multitenancy agent, or an agent provisioned outside this database), in
    which case lookups stay unscoped exactly as they were before.
    """
    from src.db import School

    agent_id = getattr(request_data, "agent_id", None)
    if not agent_id and req:
        agent_id = req.headers.get("x-retell-agent-id")
    if not agent_id:
        return None

    # Cached by agent id — resolved on every tool call, and an agent's school
    # only changes when a school is re-provisioned. Only the id is cached, not
    # the ORM row, so nothing stale is ever attached to a live session.
    from src.cache import school_cache

    def _load():
        school = db.query(School).filter(School.retell_agent_id == agent_id).first()
        return school.id if school else None

    return school_cache.get_or_load(f"agent:{agent_id}", _load)


def resolve_contact(db: Session, req: Request, request_data: Any) -> Optional[Contact]:
    # Which school's agent is on this call. Every lookup below that searches by
    # something a caller can SAY (their phone number, their email) or that
    # guesses from recent activity is restricted to this school — otherwise two
    # schools sharing a lead's phone number could have a booking attached to
    # the wrong tenant's record entirely.
    school_id = resolve_calling_school_id(db, req, request_data)

    def _scoped(query):
        return query.filter(Contact.school_id == school_id) if school_id else query

    # 1. Try resolving via Retell call ID from JSON body / request data.
    #    This path is already tenant-safe: the CallAttempt row was created by
    #    whichever dial placed THIS call, so it can only point at that call's
    #    own contact. No scoping needed (and none applied, so a call placed
    #    before the contact had a school still resolves).
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
        contact = _scoped(db.query(Contact).filter(Contact.id == contact_id)).first()
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
            contact = _scoped(db.query(Contact).filter(Contact.phone_number == phone)).first()
            if not contact:
                for cand in _scoped(db.query(Contact).filter(Contact.phone_number.like(f"%{last10}"))).all():
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
        contact = _scoped(db.query(Contact).filter(
            func.lower(Contact.email) == email.strip().lower()
        )).first()
        if contact:
            print(f"[TOOLS] Resolved contact {contact.id} from attendee_email: {email}")
            return contact

    # 4. Safe last-resort fallback. The dialer supports multiple concurrent
    #    calls, so guessing "the most recently updated contact" is only safe
    #    when there is exactly ONE plausible candidate — otherwise we risk
    #    attaching a booking/callback/outcome to the wrong lead. If it's
    #    ambiguous, refuse to guess and let the caller-facing tool respond
    #    gracefully instead of silently corrupting someone else's record.
    #    Scoped to the calling school too: another tenant's concurrent call
    #    must not make this one "ambiguous", nor ever be the single guess.
    from datetime import timedelta
    calling_cutoff = datetime.utcnow() - timedelta(minutes=10)
    calling_candidates = _scoped(db.query(Contact).filter(
        Contact.status == "Calling",
        Contact.updated_at >= calling_cutoff
    )).all()

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
    recent_candidates = _scoped(db.query(Contact).filter(
        Contact.status.in_(["Scheduled", "Completed"]),
        Contact.updated_at >= recent_cutoff
    )).order_by(Contact.updated_at.desc()).all()

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

        attempt = db.query(CallAttempt).filter(
            CallAttempt.contact_id == contact_id
        ).order_by(CallAttempt.started_at.desc()).first()
        ctx_text = f"{request.reason or ''} {attempt.summary if attempt and attempt.summary else ''} {attempt.transcript if attempt and attempt.transcript else ''}"

        from src.routers.webhooks import classify_callback_target
        target_type = classify_callback_target(ctx_text, followup_type=getattr(request, "followup_type", None))

        if existing:
            # Update the existing one instead of creating a duplicate
            existing.scheduled_for = scheduled_for
            existing.call_type = target_type
            existing.reason = f"{target_type} Callback ({request.reason})"
            db.commit()
        else:
            # Create ScheduledCallback
            callback = ScheduledCallback(
                contact_id=contact_id,
                scheduled_for=scheduled_for,
                reason=f"{target_type} Callback ({request.reason})",
                status="Scheduled",
                call_type=target_type
            )
            db.add(callback)
        
        # Update contact status to Scheduled
        contact = db.query(Contact).filter(Contact.id == contact_id).first()
        if contact:
            contact.status = "Scheduled"
            contact.updated_at = datetime.utcnow()
            if target_type == "Counselor":
                contact.counselor_followup_status = "Pending"
                from src.routers.contacts import auto_assign_hot_lead
                assigned_cns = auto_assign_hot_lead(db, contact)
                if assigned_cns:
                    print(f"[TOOLS] Auto-assigned counselor {assigned_cns.name} to {contact.name}")
                
                # Log counselor activity so it shows immediately in the counselor timeline
                from src.db import CounselorActivity
                db.add(CounselorActivity(
                    contact_id=contact.id,
                    counselor_id=assigned_cns.id if assigned_cns else None,
                    action_type="CallbackRequested",
                    outcome="Pending",
                    notes=f"Parent requested admissions counselor callback for {readable_time}. Reason: {request.reason or 'Counselor consultation'}"
                ))
        
        db.commit()

        event_manager.broadcast_sync(
            "CALLBACK_SCHEDULED",
            {
                "contact_id": contact_id,
                "readable_time": readable_time,
                "reason": request.reason,
                "call_type": target_type
            },
            school_id=contact.school_id if contact else None
        )
        
        if target_type == "Counselor":
            print(f"[TOOLS] Classified as Counselor Callback for {contact.name if contact else contact_id} — assigned to counselor, AI auto-dial bypassed.")
            return {"result": f"Admissions counselor callback successfully scheduled for {readable_time}. Our admissions counselor will call you then with full details!"}

        # Register APScheduler one-shot job ONLY for AI Agent callbacks
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
                    id=f"cb_{contact_id}_{int(scheduled_for.timestamp())}",
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
    stale_calcom_booking_uid: str = None,
    school_id: str = None
):
    import asyncio
    from src.db import SessionLocal, Appointment, School
    from src.services.google_calendar import create_event, cancel_event
    from src.services.email_sender import send_booking_email
    from src.school_settings import cal_com_is_configured
    from src import cal_com

    db = SessionLocal()
    gcal_html_link = None
    virtual_meeting_link = None
    try:
        school = db.query(School).filter(School.id == school_id).first() if school_id else None

        # ── Cal.com is the primary path for EVERY appointment ───────────────
        # It books the slot, writes the event to the calendar connected to the
        # Cal.com account, and emails the attendee — all three in one call. So
        # when it succeeds there is nothing left for the Google Calendar insert
        # or the SMTP send below to do, and running them anyway would put a
        # duplicate event on a second calendar and send the attendee a second,
        # differently-worded confirmation for the same appointment.
        # Google Calendar + SMTP remain as the fallback for a school that has
        # no Cal.com credentials, so such a school still gets an event and an
        # email rather than silently nothing.
        cal_com_handled = False
        if cal_com_is_configured(db, school):
            if stale_calcom_booking_uid:
                try:
                    asyncio.run(cal_com.cancel_booking(db, stale_calcom_booking_uid, reason="Rescheduled", school=school))
                    print(f"[BACKGROUND] Cancelled stale Cal.com booking: {stale_calcom_booking_uid}", flush=True)
                except Exception as cancel_err:
                    print(f"[BACKGROUND] Failed to cancel stale Cal.com booking {stale_calcom_booking_uid}: {cancel_err}", flush=True)
            try:
                cal_result = asyncio.run(cal_com.create_booking(
                    db=db,
                    contact_name=attendee_name,
                    contact_email=attendee_email or "guest@example.com",
                    start_time=start_iso,
                    school=school,
                    meeting_type=meeting_type,
                    purpose=purpose,
                    contact_phone=attendee_phone,
                ))
                if cal_result.get("success"):
                    cal_com_handled = True
                    virtual_meeting_link = cal_result.get("meeting_url")
                    appointment = db.query(Appointment).filter(Appointment.id == appointment_id).first()
                    if appointment:
                        appointment.calcom_booking_id = cal_result.get("uid")
                        appointment.virtual_meeting_link = virtual_meeting_link
                        db.commit()
                    print(f"[BACKGROUND] Cal.com {meeting_type} booking created: uid={cal_result.get('uid')} "
                          f"link={virtual_meeting_link or cal_result.get('location')}", flush=True)
                else:
                    print(f"[BACKGROUND] Cal.com booking failed ({cal_result.get('error')}) — "
                          f"falling back to Google Calendar + SMTP", flush=True)
            except Exception as cal_err:
                print(f"[BACKGROUND] Cal.com booking creation failed: {cal_err} — "
                      f"falling back to Google Calendar + SMTP", flush=True)

        # Rebooking an existing appointment (see book_appointment) leaves the
        # previous Google Calendar event dangling since it points at a time
        # that's no longer valid — cancel it. This runs even when Cal.com
        # handled the new booking: an appointment first booked under the old
        # Google Calendar flow and later rebooked under Cal.com would otherwise
        # leave the original event sitting on the calendar at the old time.
        if stale_calendar_event_id and credentials_json and calendar_id:
            try:
                cancel_event(credentials_json, calendar_id, stale_calendar_event_id)
                print(f"[BACKGROUND] Cancelled stale Google Calendar event: {stale_calendar_event_id}", flush=True)
            except Exception as cancel_err:
                print(f"[BACKGROUND] Failed to cancel stale Google Calendar event {stale_calendar_event_id}: {cancel_err}", flush=True)

        if not cal_com_handled and credentials_json and calendar_id:
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

        # Dispatch booking confirmation email — ONLY when Cal.com didn't already
        # send one. Cal.com emails the attendee itself as part of creating the
        # booking, so sending this too would mean two confirmations per booking.
        if cal_com_handled:
            print("[BACKGROUND] Confirmation email handled by Cal.com — skipping SMTP send.", flush=True)
        elif attendee_email and attendee_email.strip():
            try:
                email_kwargs = {}
                if school:
                    email_kwargs["school_name"] = school.name
                    if school.location:
                        email_kwargs["school_location"] = school.location
                    if school.contact_phone:
                        email_kwargs["school_phone"] = school.contact_phone
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
                    meeting_type=meeting_type,
                    **email_kwargs
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

        attendee_name = (request.attendee_name or "").strip() or contact.name or "Guest"
        attendee_phone = (request.attendee_phone or "").strip() or contact.phone_number or ""

        if request.attendee_email and request.attendee_email.strip():
            request.attendee_email = normalize_email(request.attendee_email)
            contact.email = request.attendee_email
            contact.updated_at = datetime.utcnow()

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
            db.flush()

        contact.status = "Completed"
        db.commit()

        event_manager.broadcast_sync(
            "APPOINTMENT_BOOKED",
            {
                "contact_id": contact.id,
                "appointment_id": appointment.id,
                "readable_time": readable_time,
                "meeting_type": meeting_type,
                "purpose": request.purpose
            },
            school_id=contact.school_id if contact else None
        )

        from src.school_settings import get_school_for_contact, get_google_calendar_config, get_smtp_config
        school = get_school_for_contact(db, contact)
        school_name = school.name if school else "TSRA"

        gcal_config = get_google_calendar_config(db, school)
        smtp_config = get_smtp_config(db, school)

        background_tasks.add_task(
            process_appointment_booking_async,
            appointment_id=appointment.id,
            credentials_json=gcal_config["credentials_json"],
            calendar_id=gcal_config["calendar_id"],
            start_iso=dt.isoformat(),
            summary=f"{school_name} {request.purpose} — {attendee_name}",
            description=f"Booked via the EnquiryCall voice agent. Purpose: {request.purpose}",
            attendee_name=attendee_name,
            attendee_phone=attendee_phone,
            attendee_email=(request.attendee_email or "").strip() or (contact.email or ""),
            smtp_server=smtp_config["server"],
            smtp_port_val=smtp_config["port"],
            smtp_username=smtp_config["username"],
            smtp_password=smtp_config["password"],
            smtp_from_email=smtp_config["from_email"],
            readable_time=readable_time,
            purpose=request.purpose,
            stale_calendar_event_id=stale_calendar_event_id,
            meeting_type=meeting_type,
            stale_calcom_booking_uid=stale_calcom_booking_uid,
            school_id=school.id if school else None
        )

        if meeting_type == "virtual":
            return {"result": f"Your virtual meeting for {request.purpose} has been booked for {readable_time}. You'll receive the meeting link by email shortly. We look forward to speaking with you!"}
        return {"result": f"Your appointment for {request.purpose} has been booked for {readable_time}. You'll receive a confirmation shortly. We look forward to seeing you!"}
    except Exception as e:
        return {"result": f"There was an issue booking the appointment: {str(e)}. Please call us directly to confirm your slot."}


@router.post("/book-class")
def book_demo_class(
    request: BookClassRequest,
    req: Request,
    db: Session = Depends(get_db),
    _secret: None = Depends(verify_tools_secret)
):
    """
    Tool: book_class(student_name, grade_sought, class_type, datetime_iso)
    Validates capacity via AvailabilityService and reserves a demo session seat.
    """
    try:
        from src.services.availability_service import availability_service
        from src.db import ClassBooking

        dt_str = request.datetime_iso
        if dt_str.endswith("Z"):
            dt_str = dt_str.replace("Z", "+05:30")
        if "+" not in dt_str and (dt_str.count("-") < 3):
            dt_str = dt_str + "+05:30"
        dt = datetime.fromisoformat(dt_str)
        date_str = dt.strftime("%Y-%m-%d")
        time_str = dt.strftime("%H:%M")
        readable_time = dt.strftime("%A, %d %B at %I:%M %p")

        contact = resolve_contact(db, req, request)
        school_id = contact.school_id if contact else None

        # Check capacity
        slot_status = availability_service.check_class_slot(
            db=db,
            class_type_name=request.class_type,
            booked_date_str=date_str,
            booked_time_str=time_str,
            school_id=school_id
        )

        if not slot_status["available"]:
            return {"result": f"I checked our schedule, but the {request.class_type} on {date_str} at {time_str} is currently full. Would you like me to look for an alternative time slot?"}

        # Create booking record
        booking = ClassBooking(
            school_id=school_id,
            class_type=slot_status["class_type"],
            booked_date=date_str,
            booked_time=time_str,
            student_name=request.student_name,
            phone_number=contact.phone_number if contact else "",
            email=contact.email if contact else None,
            status="upcoming",
            notes=f"Grade: {request.grade_sought or 'N/A'}"
        )
        db.add(booking)
        db.commit()

        return {
            "result": f"A demo seat for {request.student_name} in {slot_status['class_type']} has been successfully reserved for {readable_time}. We've sent the session details to your phone."
        }
    except Exception as e:
        return {"result": f"There was an issue reserving the demo seat: {str(e)}. Please contact our admissions desk directly."}


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


@router.post("/save-profile")
def save_profile(
    request: SaveProfileRequest,
    req: Request,
    db: Session = Depends(get_db),
    _secret: None = Depends(verify_tools_secret)
):
    """
    Tool: save_profile(...) — record what we just learned about this family.

    Called REPEATEDLY during one conversation, each time with only the fields
    the agent has just heard. Writes merge: a field that isn't in the payload
    leaves the stored value alone, so the profile only ever accumulates.

    Never fails the call. If the contact can't be resolved, or a value doesn't
    match its allowed vocabulary, the tool still returns a cheerful result —
    the agent is mid-sentence with a parent on the line, and an error here
    would cost the conversation to save a field. Anything dropped is logged.
    """
    try:
        from src.profile import apply_profile, completeness, FIELD_NAMES

        contact = resolve_contact(db, req, request)
        if not contact:
            print("[TOOLS] save_profile: could not resolve contact — nothing saved")
            return {"result": "Noted."}

        # Pydantic keeps the unknown-but-allowed keys in model_extra.
        payload = dict(request.model_extra or {})
        submitted = [k for k in payload if k in FIELD_NAMES]

        written = apply_profile(contact, payload)
        if written:
            contact.updated_at = datetime.utcnow()
            db.commit()

        dropped = [k for k in submitted if k not in written]
        unknown = [k for k in payload if k not in FIELD_NAMES]
        if dropped:
            # Usually an enum value outside its choice list. Worth seeing:
            # a field that is always dropped means the prompt and the allowed
            # vocabulary disagree.
            print(f"[TOOLS] save_profile: ignored values for {dropped} on contact {contact.id}")
        if unknown:
            print(f"[TOOLS] save_profile: unknown field(s) {unknown} — not in profile.py")

        filled = completeness(contact)
        print(f"[TOOLS] save_profile: saved {written} for {contact.name} ({filled}/20 known)")
        return {"result": "Noted."}

    except Exception as e:
        print(f"[TOOLS] save_profile error: {e}")
        try:
            db.rollback()
        except Exception:
            pass
        return {"result": "Noted."}


class TransferCounselorRequest(AdmissionToolBase):
    reason: Optional[str] = "Lead requested live human counselor"


@router.post("/transfer-counselor")
def transfer_counselor_tool(
    request: TransferCounselorRequest,
    req: Request,
    db: Session = Depends(get_db),
    _secret: None = Depends(verify_tools_secret)
):
    """
    Tool: transfer_to_counselor(reason)
    Resolves available admissions counselor and coordinates live call transfer.
    """
    try:
        from src.services.counselor_router import counselor_router
        contact = resolve_contact(db, req, request)
        school_id = resolve_calling_school_id(db, req, request) or (contact.school_id if contact else None)
        call_id = request.provider_call_id or request.call_id or getattr(request, "internal_call_id", None) or ""
        provider_name = request.provider or "retell"

        res = counselor_router.execute_transfer(
            provider=provider_name,
            provider_call_id=call_id,
            contact_id=contact.id if contact else None,
            school_id=school_id,
            reason=request.reason
        )

        if res.get("success"):
            return {
                "result": f"Transferring call to {res.get('counselor_name')} at {res.get('transfer_number')}.",
                "transfer_number": res.get("transfer_number"),
                "counselor_name": res.get("counselor_name")
            }
        else:
            return {
                "result": "Our senior counselors are currently in meetings with families. I have prioritized your contact details and our team will call you back shortly.",
                "transfer_number": None
            }
    except Exception as e:
        print(f"[TOOLS] transfer_counselor error: {e}")
        return {
            "result": "I will have our admissions team call you back shortly with personal assistance.",
            "transfer_number": None
        }
