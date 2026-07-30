"""
APScheduler-based background task manager.

Jobs:
  1. Safety reset: every 3 minutes — finds contacts stuck in 'Calling' for 15+ min
     and resets them to 'NeedsReschedule'.
  2. Callback dialer: every 1 minute — fires pending ScheduledCallback rows whose
     scheduled_for time has arrived.
  3. Knowledge refresh: daily (default 3 AM IST) — scrapes TSRA website and updates
     knowledge base.
"""

from apscheduler.schedulers.background import BackgroundScheduler
from datetime import datetime, timedelta
import os

_scheduler: BackgroundScheduler = None


def get_scheduler() -> BackgroundScheduler:
    return _scheduler


def init_scheduler():
    global _scheduler
    _scheduler = BackgroundScheduler(timezone="UTC")

    # Job 1: Safety reset for stuck Calling contacts
    _scheduler.add_job(
        _reset_stuck_calling_contacts,
        "interval",
        minutes=3,
        id="safety_reset",
        replace_existing=True
    )

    # Job 2: Callback dialer - fires pending callbacks
    #
    # ⚠️ DO NOT REMOVE THIS SWEEP. It looks redundant next to the exact-time
    # one-shot jobs that tools.py/webhooks.py register per callback, but those
    # one-shot jobs live in APScheduler's default IN-MEMORY store and are
    # silently lost on every process restart/redeploy. This 1-minute DB sweep
    # is the ONLY correctness guarantee that a ScheduledCallback ever fires;
    # the one-shot jobs are purely a latency optimization on top of it. The
    # atomic status='Scheduled'->'Triggering' claim in _fire_pending_callbacks
    # is what keeps the two mechanisms from double-dialing.
    _scheduler.add_job(
        _fire_pending_callbacks,
        "interval",
        minutes=1,
        id="callback_dialer",
        replace_existing=True
    )

    # Job 3: Nightly knowledge base refresh
    _scheduler.add_job(
        _refresh_knowledge_base,
        "cron",
        hour=21,
        minute=30,
        id="knowledge_refresh",
        replace_existing=True
    )

    # Job 4: Google Calendar synchronization/reconciliation
    from src.jobs.calendar_sync_job import sync_calendar_job
    _scheduler.add_job(
        sync_calendar_job,
        "interval",
        minutes=10,
        id="calendar_reconciliation",
        replace_existing=True
    )

    _scheduler.start()
    print("[SCHEDULER] Started. Safety reset job active (every 3 min).")
    print("[SCHEDULER] Callback dialer job active (every 1 min).")
    print("[SCHEDULER] Knowledge refresh job active (daily at 3 AM IST).")
    print("[SCHEDULER] Google Calendar reconciliation job active (every 10 min).")


def _reset_stuck_calling_contacts():
    """Reset contacts that have been stuck in 'Calling' for more than 15 minutes."""
    from src.db import SessionLocal, Contact
    db = SessionLocal()
    try:
        cutoff = datetime.utcnow() - timedelta(minutes=15)
        stuck = db.query(Contact).filter(
            Contact.status == "Calling",
            Contact.updated_at < cutoff
        ).all()

        if stuck:
            print(f"[SCHEDULER] Resetting {len(stuck)} stuck 'Calling' contacts to 'NeedsReschedule'")
            for c in stuck:
                c.status = "NeedsReschedule"
                c.updated_at = datetime.utcnow()
            db.commit()
    except Exception as e:
        print(f"[SCHEDULER] Safety reset error: {e}")
        db.rollback()
    finally:
        db.close()


def _requeue_or_give_up(cb, contact_label, retry_delay_minutes: int = 2, max_attempts: int = 1):
    """
    A dial attempt just failed (non-2xx from Retell, or a request exception).
    Previously this always gave up immediately ("avoid infinite loop") — now
    it gives a transient failure ONE bounded retry a couple minutes later
    before giving up for good, via cb.dial_attempts. Mutates cb in place;
    caller is responsible for the surrounding db.commit().
    """
    attempts = (cb.dial_attempts or 0) + 1
    cb.dial_attempts = attempts
    if attempts <= max_attempts:
        cb.status = "Scheduled"
        cb.scheduled_for = datetime.utcnow() + timedelta(minutes=retry_delay_minutes)
        print(f"[SCHEDULER] Dial failed for {contact_label} — requeued for retry #{attempts} in {retry_delay_minutes} min")
    else:
        cb.status = "Triggered"  # Give up after the bounded retry to avoid an infinite loop
        print(f"[SCHEDULER] Dial failed for {contact_label} after {attempts} attempts — giving up")


def _fire_pending_callbacks():
    """Fire pending ScheduledCallback rows whose time has arrived."""
    from src.db import SessionLocal, ScheduledCallback, Contact, Settings
    import os
    import httpx
    from src.agent_manager import get_or_create_local_agent

    db = SessionLocal()
    try:
        now = datetime.utcnow()
        pending = db.query(ScheduledCallback).filter(
            ScheduledCallback.status == "Scheduled",
            ScheduledCallback.scheduled_for <= now
        ).all()

        if not pending:
            return

        print(f"[SCHEDULER] Firing {len(pending)} pending callback(s)")

        # Fetch all settings from DB directly (don't call router function)
        def _get_setting(key):
            s = db.query(Settings).filter(Settings.key == key).first()
            return s.value if s else None

        api_key = _get_setting("retell_api_key") or os.getenv("RETELL_API_KEY", "")
        from_number = _get_setting("retell_phone_number") or os.getenv("RETELL_PHONE_NUMBER", "+18645812715")
        reschedule_link = _get_setting("cal_com_event_link") or ""

        # Default (shared) agent — per-contact school agents override this
        default_agent_id = get_or_create_local_agent()
        if default_agent_id and default_agent_id.startswith("agent_mock"):
            default_agent_id = None

        is_mock = not api_key or "mock" in api_key or api_key == "YOUR_RETELL_API_KEY"

        headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}

        for cb in pending:
            contact = None
            try:
                # ── Atomically claim this row before dialing ────────────────
                # The exact-time one-shot job registered by the schedule_callback
                # tool (trigger_callback_call in webhooks.py) can fire the same
                # ScheduledCallback row around the same moment this sweep runs.
                # The UPDATE...WHERE status='Scheduled' is atomic, so only one
                # of the two paths will ever see claimed == 1 and actually dial.
                claimed = db.query(ScheduledCallback).filter(
                    ScheduledCallback.id == cb.id,
                    ScheduledCallback.status == "Scheduled"
                ).update({"status": "Triggering"}, synchronize_session=False)
                db.commit()
                if not claimed:
                    print(f"[SCHEDULER] Callback {cb.id} already claimed elsewhere, skipping duplicate dial")
                    continue

                contact = db.query(Contact).filter(Contact.id == cb.contact_id).first()
                if not contact:
                    print(f"[SCHEDULER] Contact not found for callback {cb.id}")
                    cb.status = "Triggered"
                    continue

                # ── Don't dial a contact already on an active call ──────────
                # The claim above only stops THIS row firing twice; it doesn't
                # know about a call placed via a different trigger (manual
                # "Call Now", another campaign call, etc.). Defer instead of
                # ringing them a second time mid-conversation.
                if contact.status == "Calling":
                    print(f"[SCHEDULER] Contact {contact.id} is already on an active call — deferring callback {cb.id} instead of double-dialing")
                    retry_at = datetime.utcnow() + timedelta(minutes=5)
                    cb.status = "Scheduled"
                    cb.scheduled_for = retry_at
                    db.commit()
                    try:
                        from src.routers.webhooks import trigger_callback_call
                        sched = get_scheduler()
                        if sched and sched.running:
                            sched.add_job(
                                trigger_callback_call, "date", run_date=retry_at, args=[contact.id],
                                id=f"tool_cb_{contact.id}_{int(retry_at.timestamp())}", replace_existing=True
                            )
                    except Exception as resched_err:
                        print(f"[SCHEDULER] Could not re-register deferred callback job: {resched_err}")
                    continue

                # ─── Build dynamic variables (THIS was the critical missing piece) ───
                from datetime import timezone, timedelta
                dynamic_vars = {
                    "contact_id": contact.id,
                    "caller_name": contact.name,
                    "caller_email": contact.email or "",
                    "notes": contact.notes or "",
                    "campaign_name": f"Callback-{contact.id[:8]}",
                    "current_datetime": datetime.now(timezone(timedelta(hours=5, minutes=30))).replace(microsecond=0).isoformat()
                }
                if reschedule_link:
                    dynamic_vars["reschedule_link"] = reschedule_link

                task_data = {
                    "to_number": contact.phone_number,
                    "retell_llm_dynamic_variables": dynamic_vars
                }
                # Dial with the contact's own school's agent + caller ID when
                # it has one; else the shared defaults resolved above.
                from src.school_agent import get_school_agent_id
                from src.school_settings import get_school_for_contact, get_retell_phone_number
                school = get_school_for_contact(db, contact)
                agent_id = get_school_agent_id(db, contact) or default_agent_id
                contact_from_number = get_retell_phone_number(db, school) if school else from_number
                if agent_id:
                    task_data["override_agent_id"] = agent_id

                if is_mock:
                    import random
                    print(f"[SCHEDULER] MOCK callback fired for {contact.name} ({contact.phone_number})")
                    cb.status = "Triggered"
                    contact.status = "Calling"
                    contact.updated_at = datetime.utcnow()
                    continue

                safe_name = f"Callback-{contact.id[:8]}"
                body = {"from_number": contact_from_number, "name": safe_name, "tasks": [task_data]}

                r = httpx.post(
                    "https://api.retellai.com/create-batch-call",
                    headers=headers, json=body, timeout=30
                )

                if r.status_code < 400:
                    contact.status = "Calling"
                    contact.updated_at = datetime.utcnow()
                    cb.status = "Triggered"
                    print(f"[SCHEDULER] Callback call fired for {contact.name}")
                else:
                    print(f"[SCHEDULER] Retell error {r.status_code} for {contact.name}: {r.text[:200]}")
                    _requeue_or_give_up(cb, contact.name)

            except Exception as e:
                print(f"[SCHEDULER] Error firing callback for {cb.id}: {e}")
                _requeue_or_give_up(cb, contact.name if contact else cb.contact_id)

        db.commit()

    except Exception as e:
        print(f"[SCHEDULER] Callback dialer error: {e}")
        db.rollback()
    finally:
        db.close()


def _refresh_knowledge_base():
    """Nightly job to refresh the knowledge base by scraping TSRA website."""
    from src.knowledge import refresh_knowledge_base
    
    try:
        print("[SCHEDULER] Starting nightly knowledge base refresh...")
        chunk_count = refresh_knowledge_base()
        print(f"[SCHEDULER] Knowledge base refresh completed: {chunk_count} chunks")
    except Exception as e:
        print(f"[SCHEDULER] Knowledge base refresh failed: {e}")
