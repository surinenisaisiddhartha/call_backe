import os
import random
import time
import threading
import httpx
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from sqlalchemy.orm import Session
from src.db import get_db, Contact, Settings, UploadBatch
from src.routers.auth import get_current_user
from src.school_agent import get_school_agent_id
from src.dialer import dialer

router = APIRouter(prefix="/api/calls", tags=["Calling"])

async def make_retell_request(endpoint: str, method: str, body: dict = None) -> dict:
    api_key = os.getenv("RETELL_API_KEY")
    if not api_key or "mock" in api_key or api_key == "YOUR_RETELL_API_KEY" or api_key == "":
        print(f"[RETELL MOCK] Simulated request to {endpoint}")
        if endpoint == "/get-concurrency":
            return {"current_concurrency": 2, "concurrency_limit": 20}
        if endpoint == "/create-batch-call":
            return {
                "batch_call_id": f"batch_{random.randint(100000, 999999)}",
                "total_task_count": len(body.get("tasks", [])) if body else 1,
                "scheduled_timestamp": body.get("trigger_timestamp") if body else int(time.time() * 1000)
            }

    url = f"https://api.retellai.com{endpoint}"
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {api_key}"
    }

    async with httpx.AsyncClient() as client:
        try:
            if method.upper() == "GET":
                response = await client.get(url, headers=headers, timeout=30.0)
            else:
                response = await client.post(url, headers=headers, json=body, timeout=30.0)

            if response.status_code >= 400:
                print(f"Retell error body: {response.text}")
                raise HTTPException(status_code=response.status_code, detail=f"Retell API failed: {response.text}")

            return response.json()
        except HTTPException:
            raise
        except Exception as e:
            # Previously this silently faked a "batch_fallback_..." success
            # response ("fallback to mock for smooth demo") whenever the real
            # Retell request raised ANY exception (timeout, network error,
            # etc). Callers checked for a real failure via
            # `"error" in retell_res and "batch_call_id" not in retell_res`
            # — which never triggered, because the fake response always
            # included a batch_call_id alongside the error. The result: a
            # totally failed call was reported to the UI as successfully
            # triggered, and the contact got stuck showing "Calling" forever
            # with no way to know the real call was never placed, and no way
            # to see what actually went wrong. Real failures must surface as
            # real failures.
            print(f"[RETELL] Request to {endpoint} failed: {e}")
            raise HTTPException(status_code=502, detail=f"Could not reach Retell: {e}")

@router.get("/concurrency")
async def get_concurrency(db: Session = Depends(get_db), current_user: dict = Depends(get_current_user)):
    data = await make_retell_request("/get-concurrency", "GET")
    return data

@router.post("/start-campaign")
async def start_campaign(
    payload: dict,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    batch_id = payload.get("batchId")
    contact_ids = payload.get("contactIds")

    # Determine eligible contacts (always scoped to the caller's school so a
    # school can never start a campaign over another tenant's contacts)
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

    # Determine effective batch_id for campaign tracking
    effective_batch_id = batch_id or f"manual_{int(time.time())}"
    cid_list = [c.id for c in contacts_to_call]

    # Launch via CampaignDialer (handles concurrency + auto-queue)
    result = background_tasks.add_task(
        _start_dialer_campaign, effective_batch_id, cid_list
    )

    # Fetch setting for response message
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
    from src.db import UploadBatch
    live = dialer.get_status(batch_id)
    batch = db.query(UploadBatch).filter(UploadBatch.id == batch_id).first()
    if current_user.get("school_id") and batch and batch.school_id != current_user["school_id"]:
        raise HTTPException(status_code=404, detail="Campaign not found")

    from sqlalchemy import func
    from src.db import Contact
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
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    contact = db.query(Contact).filter(Contact.id == contact_id).first()
    if not contact:
        raise HTTPException(status_code=404, detail="Contact not found")
    if current_user.get("school_id") and contact.school_id != current_user["school_id"]:
        raise HTTPException(status_code=404, detail="Contact not found")

    if contact.status == "Calling":
        raise HTTPException(status_code=409, detail="This contact is already on an active call.")

    previous_status = contact.status
    contact.status = "Calling"
    contact.updated_at = datetime.utcnow()
    db.commit()

    # Everything below can fail (agent lookup, the Retell API call itself,
    # a network error). Without reverting on failure, the contact was left
    # permanently stuck showing "Calling" in the dashboard even though no
    # call was ever actually placed — confirmed happening in production.
    try:
        # Use the contact's own school's dedicated agent + caller ID (its
        # prompt carries that school's name/location); fall back to the
        # shared defaults for contacts with no school (pre-multitenancy rows).
        from src.agent_manager import get_or_create_local_agent
        from src.school_settings import get_school_for_contact, get_retell_phone_number
        school = get_school_for_contact(db, contact)
        agent_id = get_school_agent_id(db, contact) or get_or_create_local_agent()
        from_number = get_retell_phone_number(db, school)
        from datetime import timezone, timedelta
        dynamic_vars = {
            "contact_id": contact_id,
            "caller_name": contact.name,
            "caller_email": contact.email or "",
            "notes": contact.notes or "",
            "campaign_name": f"Manual-Call-{contact_id[:8]}",
            "current_datetime": datetime.now(timezone(timedelta(hours=5, minutes=30))).replace(microsecond=0).isoformat()
        }
        task_data = {
            "to_number": contact.phone_number,
            "retell_llm_dynamic_variables": dynamic_vars
        }
        if agent_id and agent_id.strip() and not agent_id.startswith("agent_mock"):
            task_data["override_agent_id"] = agent_id.strip()

        retell_res = await make_retell_request("/create-batch-call", "POST", {
            "from_number": from_number,
            "name": f"Single Call - {contact.name}",
            "tasks": [task_data]
        })

        if "error" in retell_res and "batch_call_id" not in retell_res:
            raise RuntimeError(f"Failed to trigger call: {retell_res.get('error')}")

        # Create CallAttempt row immediately with batch_call_id so the
        # call_started webhook can upgrade it to the real call_id, and
        # tools (schedule_callback, book_appointment) can resolve the contact.
        from src.db import CallAttempt
        batch_call_id = retell_res.get("batch_call_id", f"batch_manual_{contact_id[:8]}")
        attempt_count = db.query(CallAttempt).filter(CallAttempt.contact_id == contact_id).count()
        attempt = CallAttempt(
            contact_id=contact_id,
            retell_call_id=batch_call_id,
            attempt_number=attempt_count + 1,
            started_at=datetime.utcnow(),
        )
        db.add(attempt)
        db.commit()

        return {
            "success": True,
            "message": f"Triggered call to {contact.name}",
            "retellBatch": retell_res
        }
    except Exception as e:
        contact.status = previous_status
        contact.updated_at = datetime.utcnow()
        db.commit()
        raise HTTPException(status_code=400, detail=f"Failed to trigger call: {e}")


