import os
import json
import hmac
import hashlib
from datetime import datetime
from fastapi import APIRouter, Depends, BackgroundTasks, Request, HTTPException
from sqlalchemy.orm import Session
from src.db import get_db, Contact, CallAttempt, ScheduledCallback, Settings

router = APIRouter(prefix="/api/webhooks", tags=["Webhooks"])


def _get_setting_or_env(db: Session, key: str, env_key: str) -> str:
    s = db.query(Settings).filter(Settings.key == key).first()
    return (s.value if s else None) or os.getenv(env_key)


@router.post("/retell")
async def retell_webhook(
    request: Request,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db)
):
    body_bytes = await request.body()
    api_key = _get_setting_or_env(db, "retell_api_key", "RETELL_API_KEY")

    # Verify Retell's HMAC signature (X-Retell-Signature) whenever a real API
    # key is configured. This is what proves the request actually came from
    # Retell and not from anyone who found this public webhook URL.
    if api_key and api_key != "YOUR_RETELL_API_KEY" and "mock" not in api_key:
        signature = request.headers.get("x-retell-signature")
        if not signature:
            print("[WEBHOOK] Rejected: missing X-Retell-Signature header")
            raise HTTPException(status_code=401, detail="Missing signature")
        try:
            from retell.lib import verify as retell_verify_signature
            valid = retell_verify_signature(body_bytes.decode("utf-8"), api_key, signature)
        except Exception as verify_err:
            print(f"[WEBHOOK] Signature verification error: {verify_err}")
            valid = False
        if not valid:
            print("[WEBHOOK] Rejected: invalid Retell signature")
            raise HTTPException(status_code=401, detail="Invalid signature")
    else:
        print("[WEBHOOK] WARNING: no real Retell API key configured — skipping signature verification (mock/demo mode)")

    payload = json.loads(body_bytes)
    background_tasks.add_task(process_webhook_payload, payload)
    return {"received": True}


def process_webhook_payload(payload: dict):
    from src.db import SessionLocal
    from src.callback_parser import has_callback_intent, extract_callback_phrase, parse_callback_time
    from src.dialer import dialer

    import json
    db = SessionLocal()
    try:
        # Dump payload for debugging
        try:
            import os
            # Resolve log directory relative to backend directory
            backend_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
            log_dir = os.path.join(backend_dir, "webhook_logs")
            os.makedirs(log_dir, exist_ok=True)
            with open(f"{log_dir}/webhook_log_{int(datetime.utcnow().timestamp())}_{payload.get('event')}.json", "w") as f:
                json.dump(payload, f, indent=2)
        except Exception as log_err:
            print("Failed to log webhook:", log_err)

        if not payload or "call" not in payload:
            return

        event = payload.get("event")
        call = payload.get("call", {})

        call_id = call.get("call_id")
        batch_call_id = call.get("batch_call_id")
        to_number = call.get("to_number")
        disconnection_reason = call.get("disconnection_reason")
        duration_ms = call.get("duration_ms", 0) or 0
        call_analysis = call.get("call_analysis", {}) or {}
        recording_url = call.get("recording_url") or call_analysis.get("recording_url")

        print(f"[WEBHOOK] Event={event} | Call={call_id} | Batch={batch_call_id} | Reason={disconnection_reason}")

        if event not in ["call_started", "call_ended", "call_analyzed"]:
            return

        # ── 0. Handle call_started — register real call_id on CallAttempt ──────
        if event == "call_started":
            if call_id:
                # Try to find an existing attempt by real call_id
                attempt = db.query(CallAttempt).filter(CallAttempt.retell_call_id == call_id).first()

                if not attempt and batch_call_id:
                    # Look for an attempt stored under batch_call_id (how dialer/callback stores it)
                    attempt = db.query(CallAttempt).filter(
                        CallAttempt.retell_call_id == batch_call_id
                    ).first()
                    if attempt:
                        # Upgrade: replace batch_call_id with real call_id so tools can resolve
                        attempt.retell_call_id = call_id
                        db.commit()
                        print(f"[WEBHOOK] call_started: updated batch->real call_id for contact {attempt.contact_id}")

                if not attempt:
                    # No attempt found yet — contact was created via phone number (e.g. manual call)
                    contact = db.query(Contact).filter(
                        Contact.phone_number == to_number
                    ).order_by(Contact.updated_at.desc()).first()
                    if contact:
                        count = db.query(CallAttempt).filter(CallAttempt.contact_id == contact.id).count()
                        attempt = CallAttempt(
                            contact_id=contact.id,
                            retell_call_id=call_id,
                            attempt_number=count + 1,
                            started_at=datetime.utcnow(),
                        )
                        db.add(attempt)
                        db.commit()
                        print(f"[WEBHOOK] call_started: created new CallAttempt for {contact.id} via phone lookup")

                if attempt and not attempt.started_at:
                    attempt.started_at = datetime.utcnow()
                    db.commit()
                    print(f"[WEBHOOK] call_started: set started_at for {call_id}")
            return

        # ── 1. Find the Contact ────────────────────────────────────────────
        contact_id = None

        if batch_call_id:
            callback_row = db.query(ScheduledCallback).filter(
                ScheduledCallback.batch_call_id == batch_call_id
            ).first()
            if callback_row:
                contact_id = callback_row.contact_id

        contact = None
        if not contact_id:
            contact = db.query(Contact).filter(
                Contact.phone_number == to_number
            ).order_by(Contact.updated_at.desc()).first()
            if contact:
                contact_id = contact.id
        else:
            contact = db.query(Contact).filter(Contact.id == contact_id).first()

        if not contact_id:
            print(f"[WEBHOOK] No contact found for phone: {to_number}")
            # Still free a dialer slot so the next contact can be called
            if call_id:
                dialer.on_call_ended(call_id)
            return

        # ── 2. Map outcome & contact status ───────────────────────────────
        duration_sec = duration_ms / 1000.0
        transcript = call.get("transcript") or call_analysis.get("transcript") or ""
        summary = call.get("summary") or call_analysis.get("summary") or ""

        # Was mark_outcome already called mid-call? (it appends "Agent Outcome:"
        # to the CallAttempt's summary — see tools.py mark_outcome). If so, the
        # agent reached its scripted close (booked/rescheduled/DNC/etc.) before
        # hanging up. If not, and the CALLER is the one who hung up, the call
        # was abandoned mid-conversation with nothing actually resolved.
        _existing_attempt = None
        if call_id:
            _existing_attempt = db.query(CallAttempt).filter(CallAttempt.retell_call_id == call_id).first()
            if not _existing_attempt and batch_call_id:
                _existing_attempt = db.query(CallAttempt).filter(CallAttempt.retell_call_id == batch_call_id).first()
        mark_outcome_recorded = bool(_existing_attempt and _existing_attempt.summary and "Agent Outcome:" in _existing_attempt.summary)

        if disconnection_reason == "dial_no_answer":
            outcome, contact_status = "NoAnswer", "NeedsReschedule"
        elif disconnection_reason == "dial_busy":
            outcome, contact_status = "Busy", "NeedsReschedule"
        elif disconnection_reason == "user_hangup" and duration_sec < 5:
            outcome, contact_status = "NoAnswer", "NeedsReschedule"
        elif disconnection_reason == "dial_failed":
            outcome, contact_status = "Failed", "Failed"
        elif disconnection_reason == "user_hangup" and not mark_outcome_recorded:
            # Caller ended the call mid-conversation before the agent reached
            # its scripted close — nothing was actually resolved, so this needs
            # the same auto-reschedule treatment as a NoAnswer, not "Completed".
            outcome, contact_status = "IncompleteHangup", "NeedsReschedule"
        elif disconnection_reason in ["user_hangup", "agent_hangup", None]:
            outcome, contact_status = "Answered", "Completed"
        else:
            outcome, contact_status = "Failed", "Failed"

        # ── 2.5 Retry/Backoff & Smart Callback — ONLY on call_analyzed ────
        # Running on both call_ended AND call_analyzed was causing duplicate
        # ScheduledCallback rows and double APScheduler jobs.
        callback_raw_text = None
        auto_scheduled = False

        if event == "call_analyzed":
            # ── Retry/Backoff Logic for NoAnswer/Failed/IncompleteHangup ──
            # max_retry_attempts counts TOTAL attempts for the contact, so the
            # default of 3 means: 1 original call + up to 2 auto-rescheduled
            # retries before giving up and marking the contact Failed.
            if outcome in ["NoAnswer", "Failed", "IncompleteHangup"]:
                s_max = db.query(Settings).filter(Settings.key == "max_retry_attempts").first()
                s_backoff = db.query(Settings).filter(Settings.key == "retry_backoff_hours").first()

                max_attempts = int((s_max.value if s_max else None) or os.getenv("MAX_RETRY_ATTEMPTS", "3"))
                backoff_hours = int((s_backoff.value if s_backoff else None) or os.getenv("RETRY_BACKOFF_HOURS", "4"))

                attempt_count = db.query(CallAttempt).filter(
                    CallAttempt.contact_id == contact_id
                ).count()

                if attempt_count < max_attempts:
                    from datetime import timedelta
                    retry_time = datetime.utcnow() + timedelta(hours=backoff_hours)

                    # Idempotent: only create if no existing Scheduled callback
                    existing_retry = db.query(ScheduledCallback).filter(
                        ScheduledCallback.contact_id == contact_id,
                        ScheduledCallback.status == "Scheduled"
                    ).first()
                    if not existing_retry:
                        cb = ScheduledCallback(
                            contact_id=contact_id,
                            scheduled_for=retry_time,
                            reason=f"Auto-retry after {outcome}",
                            status="Scheduled",
                            call_type="Reminder"
                        )
                        db.add(cb)
                        print(f"[WEBHOOK] Auto-scheduled retry for {contact_id} at {retry_time} (attempt {attempt_count + 1}/{max_attempts})")
                    else:
                        print(f"[WEBHOOK] Retry already scheduled for {contact_id}, skipping duplicate")
                else:
                    contact_status = "Failed"
                    print(f"[WEBHOOK] Max retry attempts reached for {contact_id}, marking as Failed")

            # ── Smart Callback Detection ──────────────────────────────────
            # This is a fallback safety net for calls where the caller asked
            # to be called back but the agent's schedule_callback tool call
            # didn't go through — NOT meant to run on calls the agent already
            # resolved definitively. Without this guard, a successful virtual
            # meeting booking (whose summary/transcript naturally contains
            # "meeting" — one of CALLBACK_KEYWORDS) got misread as a callback
            # request, causing an actual outbound phone call to be scheduled
            # at the same time as the booked meeting (confirmed in production).
            _no_followup_outcomes = ("appointment_booked", "not_interested", "do_not_call", "wrong_number")
            _agent_resolved_definitively = mark_outcome_recorded and _existing_attempt and any(
                f"Agent Outcome: {o}" in _existing_attempt.summary for o in _no_followup_outcomes
            )
            if not _agent_resolved_definitively and (outcome == "Answered" or (summary and has_callback_intent(summary))):
                combined_text = f"{summary}\n{transcript}"
                if has_callback_intent(combined_text):
                    phrase = extract_callback_phrase(summary, transcript)
                    if phrase:
                        callback_raw_text = phrase
                        scheduled_utc = parse_callback_time(phrase)
                        if scheduled_utc:
                            # Attempt to create Google Calendar event
                            from src.services.google_calendar import create_event
                            c_event_id = None
                            try:
                                settings_list = db.query(Settings).all()
                                settings_map = {s.key: s.value for s in settings_list}
                                credentials_json = settings_map.get("google_calendar_credentials_json") or os.getenv("GOOGLE_CALENDAR_CREDENTIALS_JSON")
                                calendar_id = settings_map.get("google_calendar_id") or os.getenv("GOOGLE_CALENDAR_ID")

                                if credentials_json and calendar_id and contact:
                                    result = create_event(
                                        credentials_json=credentials_json,
                                        calendar_id=calendar_id,
                                        start_iso=scheduled_utc.isoformat() + "+00:00",
                                        summary=f"TSRA Callback — {contact.name}",
                                        description=f"Automated retry callback scheduled. Raw phrase: {phrase}",
                                        attendee_name=contact.name,
                                        attendee_phone=contact.phone_number,
                                        appointment_id=f"callback_{contact.id}",
                                    )
                                    c_event_id = result["event_id"]
                            except Exception as e:
                                print(f"[WEBHOOK] Google Calendar callback sync failed: {e}")

                            # Idempotent: update if already exists (e.g. tool created one mid-call)
                            existing_cb = db.query(ScheduledCallback).filter(
                                ScheduledCallback.contact_id == contact_id,
                                ScheduledCallback.status == "Scheduled"
                            ).first()

                            if existing_cb:
                                existing_cb.scheduled_for = scheduled_utc
                                if c_event_id:
                                    existing_cb.google_calendar_event_id = c_event_id
                                if batch_call_id:
                                    existing_cb.batch_call_id = batch_call_id
                                print(f"[WEBHOOK] Updated existing ScheduledCallback for {contact_id}")
                            else:
                                cb = ScheduledCallback(
                                    contact_id=contact_id,
                                    scheduled_for=scheduled_utc,
                                    status="Scheduled",
                                    batch_call_id=batch_call_id,
                                    google_calendar_event_id=c_event_id
                                )
                                db.add(cb)
                            contact_status = "Scheduled"
                            auto_scheduled = True

                            # Register APScheduler one-shot job (only on call_analyzed)
                            try:
                                from src.scheduler import get_scheduler
                                sched = get_scheduler()
                                if sched and sched.running:
                                    sched.add_job(
                                        trigger_callback_call,
                                        "date",
                                        run_date=scheduled_utc,
                                        args=[contact_id],
                                        id=f"cb_{contact_id}_{int(scheduled_utc.timestamp())}",
                                        replace_existing=True
                                    )
                                    print(f"[WEBHOOK] Auto-scheduled callback for {contact_id} at {scheduled_utc} UTC")
                            except Exception as sched_err:
                                print(f"[WEBHOOK] Scheduler error: {sched_err}")

        # ── 3. Upsert CallAttempt ──────────────────────────────────────────
        attempt = None
        if call_id:
            attempt = db.query(CallAttempt).filter(CallAttempt.retell_call_id == call_id).first()
            if not attempt and batch_call_id and contact_id:
                attempt = db.query(CallAttempt).filter(
                    CallAttempt.retell_call_id == batch_call_id,
                    CallAttempt.contact_id == contact_id
                ).first()
                if attempt:
                    attempt.retell_call_id = call_id
                    db.commit()

        if attempt:
            attempt.ended_at = datetime.utcnow()
            attempt.outcome = outcome
            attempt.duration_sec = duration_sec
            if recording_url:
                attempt.recording_url = recording_url
            if transcript:
                attempt.transcript = transcript
            if summary:
                attempt.summary = summary
            if callback_raw_text:
                attempt.callback_raw_text = callback_raw_text
        else:
            count = db.query(CallAttempt).filter(CallAttempt.contact_id == contact_id).count()
            attempt = CallAttempt(
                contact_id=contact_id,
                retell_call_id=call_id or f"retell_{contact_id[:8]}",
                attempt_number=count + 1,
                started_at=datetime.utcnow(),
                ended_at=datetime.utcnow(),
                outcome=outcome,
                duration_sec=duration_sec,
                recording_url=recording_url,
                transcript=transcript or None,
                summary=summary or None,
                callback_raw_text=callback_raw_text
            )
            db.add(attempt)

        # ── 4. Update Contact status ───────────────────────────────────────
        if contact:
            contact.status = contact_status
            contact.updated_at = datetime.utcnow()

        try:
            db.commit()
        except Exception as e:
            db.rollback()
            # If unique constraint failed, retry as update
            if call_id and "UNIQUE constraint failed" in str(e):
                print(f"[WEBHOOK] Insert failed with UNIQUE constraint, retrying as update for {call_id}...")
                attempt = db.query(CallAttempt).filter(CallAttempt.retell_call_id == call_id).first()
                if attempt:
                    attempt.ended_at = datetime.utcnow()
                    attempt.outcome = outcome
                    attempt.duration_sec = duration_sec
                    if recording_url:
                        attempt.recording_url = recording_url
                    if transcript:
                        attempt.transcript = transcript
                    if summary:
                        attempt.summary = summary
                    if callback_raw_text:
                        attempt.callback_raw_text = callback_raw_text
                    if contact:
                        contact.status = contact_status
                        contact.updated_at = datetime.utcnow()
                    db.commit()
                else:
                    raise e
            else:
                raise e
        print(f"[WEBHOOK] Contact {contact_id} => {contact_status} | AutoScheduled={auto_scheduled}")

        # ── 5. Free dialer slot → auto-dial next contact ──────────────────
        # Only fire on call_ended (not call_analyzed) to prevent duplicate dialing.
        # call_analyzed fires after call_ended for the same call; freeing the slot
        # on both events would launch two new calls for one finished slot.
        if call_id and event == "call_ended":
            dialer.on_call_ended(call_id)

    except Exception as e:
        print("Webhook processing error:", e)
        import traceback
        traceback.print_exc()
        db.rollback()
    finally:
        db.close()


def trigger_callback_call(contact_id: str):
    """Called by APScheduler at the scheduled callback time. Fires a Retell call."""
    from src.db import SessionLocal, Contact, ScheduledCallback, Settings, CallAttempt
    import os, httpx

    db = SessionLocal()
    try:
        contact = db.query(Contact).filter(Contact.id == contact_id).first()
        if not contact:
            return

        # ── Atomically claim the pending ScheduledCallback row ──────────────
        # scheduler.py also has a generic 1-minute sweep (_fire_pending_callbacks)
        # that fires any row still "Scheduled" once its time has passed. Without
        # this claim, this exact-time job and that sweep could both fire the
        # same callback around the same moment and double-dial the contact.
        # The UPDATE...WHERE status='Scheduled' is atomic at the SQL level, so
        # only one of the two code paths will ever see rowcount == 1.
        cb = db.query(ScheduledCallback).filter(
            ScheduledCallback.contact_id == contact_id,
            ScheduledCallback.status == "Scheduled"
        ).order_by(ScheduledCallback.scheduled_for.desc()).first()

        if cb:
            claimed = db.query(ScheduledCallback).filter(
                ScheduledCallback.id == cb.id,
                ScheduledCallback.status == "Scheduled"
            ).update({"status": "Triggering"}, synchronize_session=False)
            db.commit()
            if not claimed:
                print(f"[SCHEDULER] Callback for {contact_id} already claimed/fired elsewhere, skipping duplicate dial")
                return

        # ── Don't dial a contact who's already on an active call ────────────
        # The claim above only stops the SAME scheduled_callback row firing
        # twice; it doesn't know about a call placed via a different trigger
        # (a manual "Call Now", another campaign call, etc.). Without this
        # check, a callback can ring the contact again while they're still
        # mid-conversation on an unrelated call. If busy, push this callback
        # a few minutes out and let it retry then instead of double-dialing.
        db.refresh(contact)
        if contact.status == "Calling":
            print(f"[SCHEDULER] Contact {contact_id} is already on an active call — deferring this callback instead of double-dialing")
            if cb:
                from datetime import timedelta as _td
                retry_at = datetime.utcnow() + _td(minutes=5)
                db.query(ScheduledCallback).filter(ScheduledCallback.id == cb.id).update(
                    {"status": "Scheduled", "scheduled_for": retry_at}, synchronize_session=False
                )
                db.commit()
                try:
                    from src.scheduler import get_scheduler
                    sched = get_scheduler()
                    if sched and sched.running:
                        sched.add_job(
                            trigger_callback_call, "date", run_date=retry_at, args=[contact_id],
                            id=f"tool_cb_{contact_id}_{int(retry_at.timestamp())}", replace_existing=True
                        )
                except Exception as resched_err:
                    print(f"[SCHEDULER] Could not re-register deferred callback job: {resched_err}")
            return

        # Get settings
        ak = db.query(Settings).filter(Settings.key == "retell_api_key").first()
        fn = db.query(Settings).filter(Settings.key == "retell_phone_number").first()

        api_key = (ak.value if ak else None) or os.getenv("RETELL_API_KEY", "")
        from_number = (fn.value if fn else None) or os.getenv("RETELL_PHONE_NUMBER", "+18645812715")

        # Dial with the contact's own school's agent when it has one, so the
        # callback speaks that school's name; else the shared default agent.
        from src.agent_manager import get_or_create_local_agent
        from src.school_agent import get_school_agent_id
        agent_id = get_school_agent_id(db, contact) or get_or_create_local_agent()

        from datetime import timezone, timedelta
        dynamic_vars = {
            "contact_id": contact_id,
            "caller_name": contact.name,
            "caller_email": contact.email or "",
            "notes": contact.notes or "",
            "campaign_name": f"Callback-{contact_id[:8]}",
            "current_datetime": datetime.now(timezone(timedelta(hours=5, minutes=30))).replace(microsecond=0).isoformat()
        }

        task_data = {"to_number": contact.phone_number, "retell_llm_dynamic_variables": dynamic_vars}
        if agent_id and agent_id.strip():
            task_data["override_agent_id"] = agent_id.strip()

        headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
        body = {"from_number": from_number, "name": f"Callback-{contact_id[:8]}", "tasks": [task_data]}

        r = httpx.post("https://api.retellai.com/create-batch-call", headers=headers, json=body, timeout=30)
        if r.status_code < 400:
            data = r.json()
            batch_call_id = data.get("batch_call_id", f"batch_cb_{contact_id[:8]}")

            # ── Create CallAttempt immediately with the batch_call_id ─────
            # This ensures tools (schedule_callback, book_appointment) can
            # resolve the contact via x-retell-call-id when call_started
            # fires and updates the batch_call_id → real call_id.
            attempt_count = db.query(CallAttempt).filter(CallAttempt.contact_id == contact_id).count()
            attempt = CallAttempt(
                contact_id=contact_id,
                retell_call_id=batch_call_id,
                attempt_number=attempt_count + 1,
                started_at=datetime.utcnow(),
            )
            db.add(attempt)

            contact.status = "Calling"
            contact.updated_at = datetime.utcnow()

            if cb:
                cb.status = "Triggered"
            db.commit()
            print(f"[SCHEDULER] Callback call fired for {contact.name} | batch_call_id={batch_call_id}")
        else:
            print(f"[SCHEDULER] Retell error for callback: {r.text}")
            # Dial failed — mark Triggered anyway (rather than leaving it stuck
            # in "Triggering" forever) so it doesn't silently block future retries.
            if cb:
                cb.status = "Triggered"
                db.commit()
    except Exception as e:
        print(f"[SCHEDULER] trigger_callback_call error: {e}")
        import traceback
        traceback.print_exc()
        db.rollback()
    finally:
        db.close()


@router.post("/cal")
async def cal_webhook(
    request: Request,
    db: Session = Depends(get_db)
):
    body_bytes = await request.body()

    # Verify Cal.com's HMAC signature (X-Cal-Signature-256) whenever a webhook
    # secret is configured (set the same secret in the Cal.com webhook config).
    secret = _get_setting_or_env(db, "cal_com_webhook_secret", "CAL_COM_WEBHOOK_SECRET")
    if secret:
        provided_sig = request.headers.get("x-cal-signature-256")
        expected_sig = hmac.new(secret.encode(), body_bytes, hashlib.sha256).hexdigest()
        if not provided_sig or not hmac.compare_digest(provided_sig, expected_sig):
            print("[CAL.COM WEBHOOK] Rejected: missing or invalid signature")
            raise HTTPException(status_code=401, detail="Invalid signature")
    else:
        print("[CAL.COM WEBHOOK] WARNING: cal_com_webhook_secret not configured — skipping signature verification")

    try:
        body = json.loads(body_bytes)
        trigger_event = body.get("triggerEvent")
        payload = body.get("payload", {})

        print(f"[CAL.COM WEBHOOK] Event: {trigger_event}")

        if trigger_event in ["BOOKING_CREATED", "BOOKING_RESCHEDULED"]:
            attendees = payload.get("attendees", [])
            start_time_str = payload.get("startTime")

            if not attendees or not start_time_str:
                return {"success": False, "message": "Missing attendees or startTime"}

            try:
                dt_str = start_time_str.replace("Z", "")
                if "." in dt_str:
                    dt_str = dt_str.split(".")[0]
                scheduled_for = datetime.strptime(dt_str, "%Y-%m-%dT%H:%M:%S")
            except Exception as e:
                print("Failed to parse start time:", e)
                scheduled_for = datetime.utcnow()

            contact = None
            for att in attendees:
                email = att.get("email")
                if email:
                    contact = db.query(Contact).filter(Contact.email.ilike(email)).first()
                    if contact:
                        break

            if contact:
                contact.status = "Completed"
                contact.updated_at = datetime.utcnow()

                callback = db.query(ScheduledCallback).filter(
                    ScheduledCallback.contact_id == contact.id,
                    ScheduledCallback.status == "Scheduled"
                ).first()
                if callback:
                    callback.scheduled_for = scheduled_for
                    callback.status = "Triggered"
                else:
                    db.add(ScheduledCallback(
                        contact_id=contact.id,
                        scheduled_for=scheduled_for,
                        status="Triggered"
                    ))
                db.commit()
                return {"success": True, "message": f"Matched contact {contact.name}"}
            else:
                emails = [a.get("email") for a in attendees if a.get("email")]
                print(f"[CAL.COM] No contact matched emails: {emails}")
                return {"success": True, "message": "No matching contact"}

        return {"success": True, "message": "Ignored event"}
    except Exception as e:
        print("Cal.com webhook error:", e)
        db.rollback()
        return {"success": False, "error": str(e)}
