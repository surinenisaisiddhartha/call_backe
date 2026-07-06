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

        # Try to get agent ID
        agent_id = get_or_create_local_agent()
        if agent_id and agent_id.startswith("agent_mock"):
            agent_id = None

        is_mock = not api_key or "mock" in api_key or api_key == "YOUR_RETELL_API_KEY"

        headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}

        for cb in pending:
            try:
                contact = db.query(Contact).filter(Contact.id == cb.contact_id).first()
                if not contact:
                    print(f"[SCHEDULER] Contact not found for callback {cb.id}")
                    cb.status = "Triggered"
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
                body = {"from_number": from_number, "name": safe_name, "tasks": [task_data]}

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
                    cb.status = "Triggered"  # Avoid infinite loop

            except Exception as e:
                print(f"[SCHEDULER] Error firing callback for {cb.id}: {e}")
                cb.status = "Triggered"

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
