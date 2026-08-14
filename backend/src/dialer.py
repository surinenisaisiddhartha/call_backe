"""
CampaignDialer — slot-based concurrent outbound call manager.

Reads MAX_CONCURRENT_CALLS from env (default 15).
Effective concurrency = min(MAX_CONCURRENT_CALLS, retell_plan_limit).

Flow:
  1. start(batch_id) loads eligible contacts into a queue
  2. Fires first min(effective_limit, queue_size) calls immediately
  3. on_call_ended(retell_call_id) frees a slot and auto-dials next contact
  4. Campaign marked 'completed' when queue empties and active_calls == 0
"""

import os
import asyncio
import threading
import time
import httpx
from datetime import datetime
from typing import Dict, Optional
from src.db import SessionLocal, Contact, UploadBatch, CallAttempt, Settings
from src.events import event_manager

def _get_concurrency_limit(db) -> int:
    s = db.query(Settings).filter(Settings.key == "concurrency_limit").first()
    return int((s.value if s else None) or os.getenv("MAX_CONCURRENT_CALLS", "15"))
def _get_retell_api_key(db) -> str:
    s = db.query(Settings).filter(Settings.key == "retell_api_key").first()
    return (s.value if s else None) or os.getenv("RETELL_API_KEY", "")


def _get_agent_id(db) -> Optional[str]:
    # Only use local agent with static prompt
    from src.agent_manager import get_or_create_local_agent
    return get_or_create_local_agent()


from src.utils import is_working_hours, next_working_day_start


class CampaignDialer:
    """
    Thread-safe, slot-based concurrent call manager.
    One instance shared across the app (singleton via module-level variable).
    """

    def __init__(self):
        self._lock = threading.Lock()
        # retell_call_id -> contact_id
        self._active: Dict[str, str] = {}
        # retell_call_id -> batch_id (so we can refill the correct campaign's
        # queue when a call ends, and compute per-campaign completion)
        self._active_batch: Dict[str, str] = {}
        # batch_id -> list of contact_ids waiting to be called
        self._queues: Dict[str, list] = {}
        # batch_id -> effective concurrency limit (fetched from Retell)
        self._limits: Dict[str, int] = {}

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def start(self, batch_id: str, contact_ids: list = None):
        """
        Start dialing a campaign. Fires up to effective_limit calls immediately.
        Can be called from an async or sync context (runs Retell calls in threads).
        Calls are restricted to the school's configured calling window (default
        9:00 AM – 9:00 PM IST).  If outside the window, contacts are auto-
        scheduled for 9 AM the next working day instead of being dropped.
        """
        db_check = SessionLocal()
        try:
            # Load per-school calling window
            batch_row = db_check.query(UploadBatch).filter(UploadBatch.id == batch_id).first()
            start_hour, start_minute, end_hour, end_minute = 9, 0, 23, 30
            if batch_row and batch_row.school_id:
                from src.db import School
                school = db_check.query(School).filter(School.id == batch_row.school_id).first()
                if school:
                    start_hour = school.calling_start_hour if school.calling_start_hour is not None else 9
                    start_minute = school.calling_start_minute if school.calling_start_minute is not None else 0
                    end_hour = school.calling_end_hour if school.calling_end_hour is not None else 23
                    end_minute = school.calling_end_minute if school.calling_end_minute is not None else 30
        finally:
            db_check.close()

        if not is_working_hours(start_hour=start_hour, start_minute=start_minute, end_hour=end_hour, end_minute=end_minute):
            from datetime import timezone, timedelta
            ist = timezone(timedelta(hours=5, minutes=30))
            now_ist = datetime.now(ist)
            # Auto-schedule for next working day instead of dropping
            retry_time = next_working_day_start(start_hour)
            db_sched = SessionLocal()
            try:
                from src.db import ScheduledCallback
                query = db_sched.query(Contact).filter(
                    Contact.batch_id == batch_id,
                    Contact.status.in_(["Pending", "NeedsReschedule", "Failed"])
                )
                if contact_ids:
                    query = query.filter(Contact.id.in_(contact_ids))
                contacts = query.all()
                scheduled_count = 0
                for c in contacts:
                    existing = db_sched.query(ScheduledCallback).filter(
                        ScheduledCallback.contact_id == c.id,
                        ScheduledCallback.status == "Scheduled"
                    ).first()
                    if not existing:
                        cb = ScheduledCallback(
                            contact_id=c.id,
                            scheduled_for=retry_time,
                            reason=f"Auto-scheduled: campaign started outside calling hours ({now_ist.strftime('%H:%M')} IST)",
                            status="Scheduled",
                            call_type="Follow-up"
                        )
                        db_sched.add(cb)
                        scheduled_count += 1
                if scheduled_count:
                    db_sched.commit()
                print(f"[DIALER] Campaign {batch_id} outside window ({now_ist.strftime('%H:%M')} IST). Auto-scheduled {scheduled_count} contacts for {retry_time}.")
            finally:
                db_sched.close()
            return {
                "queued": 0,
                "scheduled_for_tomorrow": scheduled_count if 'scheduled_count' in dir() else 0,
                "message": f"Outside calling hours ({now_ist.strftime('%H:%M')} IST, window {start_hour}:{start_minute:02d}–{end_hour}:{end_minute:02d}). Contacts auto-scheduled for {retry_time.strftime('%Y-%m-%d %H:%M')} UTC."
            }
        db = SessionLocal()
        try:
            # Mark campaign as running
            batch = db.query(UploadBatch).filter(UploadBatch.id == batch_id).first()
            if batch:
                batch.status = "running"
                db.commit()
                event_manager.broadcast_sync(
                    "CAMPAIGN_UPDATE",
                    {"batch_id": batch_id, "status": "running"},
                    school_id=batch.school_id
                )

            # Load eligible contacts
            query = db.query(Contact).filter(
                Contact.batch_id == batch_id,
                Contact.status.in_(["Pending", "NeedsReschedule", "Failed"])
            )
            if contact_ids:
                query = query.filter(Contact.id.in_(contact_ids))
            
            # Exclude DoNotCall contacts
            do_not_call_numbers = db.query(Contact.phone_number).filter(
                Contact.status == "DoNotCall"
            ).all()
            do_not_call_numbers = [n[0] for n in do_not_call_numbers]
            
            if do_not_call_numbers:
                query = query.filter(~Contact.phone_number.in_(do_not_call_numbers))
            
            contacts = query.all()

            if not contacts:
                if batch:
                    batch.status = "completed"
                    db.commit()
                return {"queued": 0, "message": "No eligible contacts"}

            # Do NOT mark all as Calling upfront — only mark per-contact when
            # _fire_call actually succeeds (done inside _fire_call)
            contact_queue = [c.id for c in contacts]

            # Fetch effective concurrency
            api_key = _get_retell_api_key(db)
            local_limit = _get_concurrency_limit(db)
            retell_limit = self._fetch_retell_concurrency_limit(api_key, local_limit)
            effective_limit = min(local_limit, retell_limit)

            with self._lock:
                self._queues[batch_id] = contact_queue
                self._limits[batch_id] = effective_limit

            # Fire first batch of calls
            fire_count = min(effective_limit, len(contact_queue))
            with self._lock:
                initial_ids = self._queues[batch_id][:fire_count]
                self._queues[batch_id] = self._queues[batch_id][fire_count:]

            for cid in initial_ids:
                threading.Thread(
                    target=self._fire_call,
                    args=(batch_id, cid),
                    daemon=True
                ).start()

            return {
                "queued": len(contact_queue),
                "firing": fire_count,
                "effective_concurrency": effective_limit
            }

        finally:
            db.close()

    def on_call_ended(self, retell_call_id: str):
        """Called from webhook when a call ends. Frees the slot for the SAME
        campaign the call belonged to and fires that campaign's next queued
        contact (if any). Calls that weren't tracked by the dialer (e.g. a
        manual single call-now) simply have nothing to refill."""
        next_cid = None
        batch_id = None
        with self._lock:
            batch_id = self._active_batch.pop(retell_call_id, None)
            self._active.pop(retell_call_id, None)

            if batch_id and self._queues.get(batch_id):
                next_cid = self._queues[batch_id].pop(0)

        if next_cid:
            threading.Thread(
                target=self._fire_call,
                args=(batch_id, next_cid),
                daemon=True
            ).start()

        # Check if any campaign is now fully done
        self._check_completion()

    def get_status(self, batch_id: str) -> dict:
        """Return live dialer status for a campaign."""
        db = SessionLocal()
        try:
            local_limit = _get_concurrency_limit(db)
        finally:
            db.close()

        with self._lock:
            queue_len = len(self._queues.get(batch_id, []))
            active_count = sum(1 for bid in self._active_batch.values() if bid == batch_id)
            limit = self._limits.get(batch_id, local_limit)
        return {
            "active_calls": active_count,
            "queued": queue_len,
            "effective_limit": limit,
        }

    def register_active(self, retell_call_id: str, contact_id: str, batch_id: str = None):
        """Manually register an active call (for call-now and campaign flows)."""
        with self._lock:
            self._active[retell_call_id] = contact_id
            if batch_id:
                self._active_batch[retell_call_id] = batch_id

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _fire_call(self, batch_id: str, contact_id: str):
        """Fire a single Retell call in a background thread."""
        # Load per-school calling window for this contact
        start_hour, start_minute, end_hour, end_minute = 9, 0, 23, 30
        db_hrs = SessionLocal()
        try:
            c_row = db_hrs.query(Contact).filter(Contact.id == contact_id).first()
            if c_row and c_row.school_id:
                from src.db import School
                school = db_hrs.query(School).filter(School.id == c_row.school_id).first()
                if school:
                    start_hour = school.calling_start_hour if school.calling_start_hour is not None else 9
                    start_minute = school.calling_start_minute if school.calling_start_minute is not None else 0
                    end_hour = school.calling_end_hour if school.calling_end_hour is not None else 23
                    end_minute = school.calling_end_minute if school.calling_end_minute is not None else 30
        finally:
            db_hrs.close()

        # Safety guard — re-queue the contact and bail out if we have drifted
        # outside working hours (e.g. a campaign was running near 11:30 PM and the
        # last webhook-triggered slot freed after 11:30 PM).
        if not is_working_hours(start_hour=start_hour, start_minute=start_minute, end_hour=end_hour, end_minute=end_minute):
            from datetime import timezone, timedelta
            ist = timezone(timedelta(hours=5, minutes=30))
            now_ist = datetime.now(ist)
            # Instead of re-queuing in memory, auto-schedule for next working day
            retry_time = next_working_day_start(start_hour)
            db_sched = SessionLocal()
            try:
                from src.db import ScheduledCallback
                existing = db_sched.query(ScheduledCallback).filter(
                    ScheduledCallback.contact_id == contact_id,
                    ScheduledCallback.status == "Scheduled"
                ).first()
                if not existing:
                    cb = ScheduledCallback(
                        contact_id=contact_id,
                        scheduled_for=retry_time,
                        reason=f"Auto-scheduled: call attempt outside calling hours ({now_ist.strftime('%H:%M')} IST)",
                        status="Scheduled",
                        call_type="Follow-up"
                    )
                    db_sched.add(cb)
                    db_sched.commit()
            finally:
                db_sched.close()
            print(f"[DIALER] Skipping call for {contact_id} — outside calling hours ({now_ist.strftime('%H:%M')} IST). Auto-scheduled for {retry_time}.")
            return
        db = SessionLocal()
        try:
            contact = db.query(Contact).filter(Contact.id == contact_id).first()
            if not contact:
                return

            api_key = _get_retell_api_key(db)
            # Dial with the contact's own school's agent + caller ID so each
            # school's calls speak its own name/location and show its own
            # number; fall back to the shared defaults for contacts with no
            # school (pre-multitenancy rows).
            from src.school_agent import get_school_agent_id
            from src.school_settings import get_school_for_contact, get_retell_phone_number
            school = get_school_for_contact(db, contact)
            from_number = get_retell_phone_number(db, school)
            agent_id = get_school_agent_id(db, contact) or _get_agent_id(db)

            from datetime import timezone, timedelta
            dynamic_vars = {
                "contact_id": contact.id,
                "caller_name": contact.name,
                "caller_email": contact.email or "",
                "notes": contact.notes or "",
                "campaign_name": f"Campaign-{batch_id[:8]}",
                "current_datetime": datetime.now(timezone(timedelta(hours=5, minutes=30))).replace(microsecond=0).isoformat()
            }

            task_data = {
                "to_number": contact.phone_number,
                "retell_llm_dynamic_variables": dynamic_vars
            }
            if agent_id and agent_id.strip() and not agent_id.startswith("agent_mock"):
                task_data["override_agent_id"] = agent_id.strip()

            is_mock = not api_key or "mock" in api_key or api_key == "YOUR_RETELL_API_KEY"

            if is_mock:
                import random
                fake_call_id = f"call_mock_{random.randint(100000, 999999)}"
                # Mark contact as Calling and create CallAttempt even in mock mode
                attempt_count = db.query(CallAttempt).filter(CallAttempt.contact_id == contact_id).count()
                attempt = CallAttempt(
                    contact_id=contact_id,
                    retell_call_id=fake_call_id,
                    attempt_number=attempt_count + 1,
                    started_at=datetime.utcnow(),
                )
                db.add(attempt)
                contact.status = "Calling"
                contact.updated_at = datetime.utcnow()
                db.commit()
                event_manager.broadcast_sync(
                    "CALL_STARTED",
                    {"contact_id": contact_id, "call_id": fake_call_id, "status": "Calling"},
                    school_id=contact.school_id
                )
                with self._lock:
                    self._active[fake_call_id] = contact_id
                    self._active_batch[fake_call_id] = batch_id
                print(f"[DIALER] MOCK call fired for {contact.name} | call_id={fake_call_id}")
                return

            headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
            body = {"from_number": from_number, "name": f"Campaign-{batch_id[:8]}", "tasks": [task_data]}

            response = httpx.post(
                "https://api.retellai.com/create-batch-call",
                headers=headers,
                json=body,
                timeout=30.0
            )

            if response.status_code < 400:
                data = response.json()
                # Retell returns batch_call_id; the real individual call_id
                # arrives later via the call_started webhook which will update
                # this row's retell_call_id to the real call_id.
                stored_call_id = data.get("batch_call_id", f"batch_{contact_id[:8]}")

                # Create CallAttempt row NOW so webhooks can match it
                attempt_count = db.query(CallAttempt).filter(CallAttempt.contact_id == contact_id).count()
                attempt = CallAttempt(
                    contact_id=contact_id,
                    retell_call_id=stored_call_id,
                    attempt_number=attempt_count + 1,
                    started_at=datetime.utcnow(),
                )
                db.add(attempt)
                contact.status = "Calling"
                contact.updated_at = datetime.utcnow()
                db.commit()
                event_manager.broadcast_sync(
                    "CALL_STARTED",
                    {"contact_id": contact_id, "call_id": stored_call_id, "status": "Calling"},
                    school_id=contact.school_id
                )

                with self._lock:
                    self._active[stored_call_id] = contact_id
                    self._active_batch[stored_call_id] = batch_id
                print(f"[DIALER] Call fired for {contact.name} | batch_call_id={stored_call_id}")
            else:
                print(f"[DIALER] Retell call failed for {contact.name}: {response.text}")
                contact.status = "Failed"
                contact.updated_at = datetime.utcnow()
                db.commit()
                event_manager.broadcast_sync(
                    "CALL_ENDED",
                    {"contact_id": contact_id, "status": "Failed"},
                    school_id=contact.school_id
                )
                self._check_completion()

        except Exception as e:
            print(f"[DIALER] Error firing call for contact {contact_id}: {e}")
            try:
                db.rollback()
            except Exception:
                pass
        finally:
            db.close()

    def _fetch_retell_concurrency_limit(self, api_key: str, fallback_limit: int) -> int:
        """Fetch actual concurrency limit from Retell. Defaults to fallback_limit on error."""
        if not api_key or "mock" in api_key:
            return fallback_limit
        try:
            r = httpx.get(
                "https://api.retellai.com/get-concurrency",
                headers={"Authorization": f"Bearer {api_key}"},
                timeout=10.0
            )
            if r.status_code == 200:
                data = r.json()
                return int(data.get("concurrency_limit", fallback_limit))
        except Exception:
            pass
        return fallback_limit

    def _check_completion(self):
        """Mark a campaign as completed once ITS OWN queue is empty and it has
        no active calls in flight — checked per-batch so one campaign's calls
        don't block another campaign from being marked complete."""
        to_complete = []
        with self._lock:
            active_counts: Dict[str, int] = {}
            for bid in self._active_batch.values():
                active_counts[bid] = active_counts.get(bid, 0) + 1

            for bid, queue in list(self._queues.items()):
                if not queue and active_counts.get(bid, 0) == 0:
                    to_complete.append(bid)
                    del self._queues[bid]
                    del self._limits[bid]

        for bid in to_complete:
            db = SessionLocal()
            try:
                batch = db.query(UploadBatch).filter(UploadBatch.id == bid).first()
                if batch:
                    batch.status = "completed"
                    db.commit()
                    event_manager.broadcast_sync(
                        "CAMPAIGN_UPDATE",
                        {"batch_id": bid, "status": "completed"},
                        school_id=batch.school_id
                    )
            finally:
                db.close()


# Singleton instance
dialer = CampaignDialer()
