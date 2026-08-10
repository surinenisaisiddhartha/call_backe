import io
import csv
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from pydantic import BaseModel
from sqlalchemy.orm import Session
from src.db import get_db, Contact, UploadBatch, CallAttempt, ScheduledCallback, School
from src.routers.auth import get_current_user
from src.profile import profile_dict, completeness
import openpyxl
import phonenumbers

router = APIRouter(prefix="/api/contacts", tags=["Contacts"])


def resolve_school_id(db: Session, current_user: dict, requested_school_id: str = None) -> str | None:
    """
    Tenant scoping: school users are ALWAYS pinned to their own school —
    whatever they request. Platform admins may target a specific school, and
    default to the original single-tenant school so pre-multitenancy behavior
    is unchanged for them.
    """
    if current_user.get("school_id"):
        return current_user["school_id"]
    if requested_school_id:
        return requested_school_id
    default = db.query(School).filter(School.slug == "shri-ram-academy").first()
    return default.id if default else None


def _normalize_phone(raw_phone) -> str | None:
    """
    Parse/validate a phone number with libphonenumber instead of a
    length-guessing heuristic. Defaults to India ("IN") as the region for
    numbers with no country code, since that was the prior hardcoded
    assumption (+91). Returns E.164 (e.g. "+919876543210") or None if the
    number isn't a real, valid number.
    """
    raw = str(raw_phone).strip()
    try:
        parsed = phonenumbers.parse(raw, "IN")
    except phonenumbers.NumberParseException:
        return None
    if not phonenumbers.is_valid_number(parsed):
        return None
    return phonenumbers.format_number(parsed, phonenumbers.PhoneNumberFormat.E164)


def _extract_row(name_val, phone_val, email_val, notes_val, row_idx: int, dnc_numbers: set):
    """
    Shared validation for one CSV/Excel row (used by both parsing branches
    below). Returns (contact_dict, None) on success or (None, error_dict) on
    a skippable row-level problem.
    """
    if not name_val:
        return None, {"row": row_idx, "error": "Name is empty"}
    if not phone_val:
        return None, {"row": row_idx, "error": "Phone number is empty"}

    clean_phone = _normalize_phone(phone_val)
    if not clean_phone:
        return None, {"row": row_idx, "error": f"'{phone_val}' is not a valid phone number"}

    if clean_phone in dnc_numbers:
        return None, {"row": row_idx, "error": f"Phone number {clean_phone} is on DoNotCall list"}

    return {
        "name": str(name_val).strip(),
        "phone": clean_phone,
        "email": str(email_val).strip() if email_val else None,
        "notes": str(notes_val).strip() if notes_val else None
    }, None


@router.post("/upload")
async def upload_excel(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    if not file.filename.endswith(('.xlsx', '.xls', '.csv')):
        raise HTTPException(status_code=400, detail="Invalid file format. Please upload an Excel (.xlsx/.xls) or CSV file.")

    try:
        contents = await file.read()
        contacts = []
        errors = []

        is_csv = file.filename.endswith('.csv')

        # Fetch the Do-Not-Call list once instead of one query per row
        # (the old code ran a fresh SELECT per row — an N+1 pattern that
        # meant a 5,000-row file issued 5,000 individual DNC lookups).
        dnc_numbers = {row[0] for row in db.query(Contact.phone_number).filter(Contact.status == "DoNotCall").all()}

        if is_csv:
            # --- CSV Parsing ---
            decoded = contents.decode("utf-8-sig")
            reader = csv.DictReader(io.StringIO(decoded))
            if not reader.fieldnames:
                raise HTTPException(status_code=400, detail="CSV file is empty or has no headers")

            # Map headers
            headers = {h.lower().replace(" ", ""): h for h in reader.fieldnames}
            name_key = next((headers[k] for k in headers if "name" in k), None)
            phone_key = next((headers[k] for k in headers if "phone" in k), None)
            email_key = next((headers[k] for k in headers if "email" in k), None)
            notes_key = next((headers[k] for k in headers if "note" in k), None)

            if not name_key or not phone_key:
                raise HTTPException(
                    status_code=400,
                    detail="Required columns 'Name' and 'PhoneNumber' not found in CSV header row."
                )

            for row_idx, row in enumerate(reader, start=2):
                name_val = row.get(name_key)
                phone_val = row.get(phone_key)
                email_val = row.get(email_key) if email_key else None
                notes_val = row.get(notes_key) if notes_key else None

                contact, error = _extract_row(name_val, phone_val, email_val, notes_val, row_idx, dnc_numbers)
                if error:
                    errors.append(error)
                    continue
                contacts.append(contact)
        else:
            # --- Excel Parsing (existing logic) ---
            workbook = openpyxl.load_workbook(filename=io.BytesIO(contents))
            worksheet = workbook.active
            if worksheet.max_row <= 1:
                raise HTTPException(status_code=400, detail="Excel sheet is empty")

            name_col_idx = None
            phone_col_idx = None
            email_col_idx = None
            notes_col_idx = None

            for col_idx in range(1, worksheet.max_column + 1):
                cell_val = worksheet.cell(row=1, column=col_idx).value
                if cell_val:
                    val = str(cell_val).lower().replace(" ", "")
                    if "name" in val:
                        name_col_idx = col_idx
                    elif "phone" in val:
                        phone_col_idx = col_idx
                    elif "email" in val:
                        email_col_idx = col_idx
                    elif "note" in val:
                        notes_col_idx = col_idx

            if name_col_idx is None or phone_col_idx is None:
                raise HTTPException(
                    status_code=400,
                    detail="Required columns 'Name' and 'PhoneNumber' not found in the header row."
                )

            for row_idx in range(2, worksheet.max_row + 1):
                name_val = worksheet.cell(row=row_idx, column=name_col_idx).value
                phone_val = worksheet.cell(row=row_idx, column=phone_col_idx).value
                email_val = worksheet.cell(row=row_idx, column=email_col_idx).value if email_col_idx else None
                notes_val = worksheet.cell(row=row_idx, column=notes_col_idx).value if notes_col_idx else None

                contact, error = _extract_row(name_val, phone_val, email_val, notes_val, row_idx, dnc_numbers)
                if error:
                    errors.append(error)
                    continue
                contacts.append(contact)

        if not contacts:
            raise HTTPException(status_code=400, detail="No valid rows found in file")

        # Insert upload batch record, pinned to the uploader's school
        school_id = resolve_school_id(db, current_user)
        batch = UploadBatch(
            school_id=school_id,
            file_name=file.filename,
            total_contacts=len(contacts),
            uploaded_by=current_user.get("email", "admin")
        )
        db.add(batch)
        db.commit()
        db.refresh(batch)

        # Insert contacts with automatic Round-Robin assignment
        counselors = db.query(Counselor).filter(Counselor.school_id == school_id).all()
        counselor_count = len(counselors)
        
        success_count = 0
        for idx, c in enumerate(contacts):
            try:
                assigned_id = None
                if counselor_count > 0:
                    assigned_id = counselors[idx % counselor_count].id

                new_contact = Contact(
                    school_id=school_id,
                    batch_id=batch.id,
                    name=c["name"],
                    phone_number=c["phone"],
                    email=c["email"],
                    notes=c["notes"],
                    status="Pending",
                    assigned_counselor_id=assigned_id
                )
                db.add(new_contact)
                success_count += 1
            except Exception as e:
                errors.append({"row": -1, "error": f"Failed to insert {c['name']}: {str(e)}"})
        
        db.commit()

        return {
            "success": True,
            "batchId": batch.id,
            "totalContacts": len(contacts),
            "successCount": success_count,
            "errors": errors
        }

    except HTTPException as he:
        raise he
    except Exception as e:
        print("File parse error:", e)
        raise HTTPException(status_code=500, detail="Failed to process file")

@router.get("/batches")
def get_batches(db: Session = Depends(get_db), current_user: dict = Depends(get_current_user)):
    from sqlalchemy import func
    query = db.query(UploadBatch)
    if current_user.get("school_id"):
        query = query.filter(UploadBatch.school_id == current_user["school_id"])
    batches = query.order_by(UploadBatch.uploaded_at.desc()).all()

    # One grouped query for EVERY campaign's status counts, instead of one per
    # campaign. Against a remote database the per-campaign version spent nearly
    # all its time on network round trips, and got linearly worse as campaigns
    # were added.
    counts_by_batch: dict = {}
    batch_ids = [b.id for b in batches]
    if batch_ids:
        rows = (
            db.query(Contact.batch_id, Contact.status, func.count(Contact.id))
            .filter(Contact.batch_id.in_(batch_ids))
            .group_by(Contact.batch_id, Contact.status)
            .all()
        )
        for batch_id, status, n in rows:
            counts_by_batch.setdefault(batch_id, {})[status] = n

    result = []
    for b in batches:
        counts = counts_by_batch.get(b.id, {})
        result.append({
            "id": b.id,
            "file_name": b.file_name,
            "uploaded_at": b.uploaded_at.isoformat(),
            "total_contacts": b.total_contacts,
            "uploaded_by": b.uploaded_by,
            "status": b.status or "idle",
            "stats": {
                "pending": counts.get("Pending", 0),
                "calling": counts.get("Calling", 0),
                "completed": counts.get("Completed", 0),
                "needs_reschedule": counts.get("NeedsReschedule", 0),
                "scheduled": counts.get("Scheduled", 0),
                "failed": counts.get("Failed", 0),
            }
        })
    return result


@router.delete("/batches/{batch_id}")
def delete_batch(
    batch_id: str,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    batch = db.query(UploadBatch).filter(UploadBatch.id == batch_id).first()
    if not batch:
        raise HTTPException(status_code=404, detail="Campaign not found")
    if current_user.get("school_id") and batch.school_id != current_user["school_id"]:
        raise HTTPException(status_code=404, detail="Campaign not found")
    
    # Due to cascade='all, delete-orphan' on UploadBatch.contacts, this will delete contacts as well.
    db.delete(batch)
    db.commit()
    return {"success": True, "message": "Campaign deleted"}

@router.get("/batches/{batch_id}/stats")
def get_batch_stats(
    batch_id: str,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    from sqlalchemy import func
    batch = db.query(UploadBatch).filter(UploadBatch.id == batch_id).first()
    if not batch:
        raise HTTPException(status_code=404, detail="Campaign not found")
    if current_user.get("school_id") and batch.school_id != current_user["school_id"]:
        raise HTTPException(status_code=404, detail="Campaign not found")

    status_counts = db.query(Contact.status, func.count(Contact.id)).filter(
        Contact.batch_id == batch_id
    ).group_by(Contact.status).all()
    counts = {s: c for s, c in status_counts}
    total = sum(counts.values()) or 1

    return {
        "id": batch.id,
        "file_name": batch.file_name,
        "status": batch.status or "idle",
        "uploaded_at": batch.uploaded_at.isoformat(),
        "total": sum(counts.values()),
        "pending": counts.get("Pending", 0),
        "calling": counts.get("Calling", 0),
        "completed": counts.get("Completed", 0),
        "needs_reschedule": counts.get("NeedsReschedule", 0),
        "scheduled": counts.get("Scheduled", 0),
        "failed": counts.get("Failed", 0),
        "completion_rate": round(counts.get("Completed", 0) / total * 100, 1),
        "answer_rate": round((counts.get("Completed", 0) + counts.get("Scheduled", 0)) / total * 100, 1),
    }


@router.get("/batches/{batch_id}/history")
def get_batch_history(
    batch_id: str,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """Return all call attempts for contacts in this campaign."""
    contact_q = db.query(Contact.id).filter(Contact.batch_id == batch_id)
    if current_user.get("school_id"):
        contact_q = contact_q.filter(Contact.school_id == current_user["school_id"])
    contact_ids = [c.id for c in contact_q.all()]
    if not contact_ids:
        return []
    attempts = db.query(CallAttempt, Contact).join(
        Contact, CallAttempt.contact_id == Contact.id
    ).filter(
        CallAttempt.contact_id.in_(contact_ids)
    ).order_by(CallAttempt.started_at.desc()).all()

    return [{
        "id": a.id,
        "contact_id": a.contact_id,
        "contact_name": c.name,
        "contact_phone": c.phone_number,
        "retell_call_id": a.retell_call_id,
        "attempt_number": a.attempt_number,
        "outcome": a.outcome,
        "duration_sec": a.duration_sec,
        "recording_url": a.recording_url,
        "transcript": a.transcript,
        "summary": a.summary,
        "callback_raw_text": a.callback_raw_text,
        "started_at": a.started_at.isoformat() if a.started_at else None,
        "ended_at": a.ended_at.isoformat() if a.ended_at else None,
        "batch_id": batch_id,
        "campaign_name": db.query(UploadBatch.file_name).filter(UploadBatch.id == batch_id).scalar()
    } for a, c in attempts]


@router.get("/history/all")
def get_all_call_history(
    status: str = None,
    batch_id: str = None,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """Global call history across all campaigns."""
    query = db.query(CallAttempt, Contact).join(
        Contact, CallAttempt.contact_id == Contact.id
    )
    if current_user.get("school_id"):
        query = query.filter(Contact.school_id == current_user["school_id"])
    if status:
        query = query.filter(CallAttempt.outcome == status)
    if batch_id:
        query = query.filter(Contact.batch_id == batch_id)

    results = query.order_by(CallAttempt.started_at.desc()).limit(500).all()

    batch_names = {}
    for a, c in results:
        if c.batch_id and c.batch_id not in batch_names:
            name = db.query(UploadBatch.file_name).filter(UploadBatch.id == c.batch_id).scalar()
            batch_names[c.batch_id] = name or c.batch_id

    return [{
        "id": a.id,
        "contact_id": a.contact_id,
        "contact_name": c.name,
        "contact_phone": c.phone_number,
        "retell_call_id": a.retell_call_id,
        "attempt_number": a.attempt_number,
        "outcome": a.outcome,
        "duration_sec": a.duration_sec,
        "recording_url": a.recording_url,
        "transcript": a.transcript,
        "summary": a.summary,
        "callback_raw_text": a.callback_raw_text,
        "started_at": a.started_at.isoformat() if a.started_at else None,
        "ended_at": a.ended_at.isoformat() if a.ended_at else None,
        "batch_id": c.batch_id,
        "campaign_name": batch_names.get(c.batch_id, "")
    } for a, c in results]


CLASSIFICATIONS = ["Hot Lead", "Warm Lead", "Time Pass", "Not Interested",
                   "Unclassified", "Not Reached"]

# -- Lead scoring ---------------------------------------------------------
# Each signal contributes a fixed, visible number of points. These weights are
# ordinary judgement, not a trained model, and they are written out here so
# anyone can argue with them and change them - a score nobody can interrogate
# is a score nobody should act on.
#
# Ordering principle: what a caller DID outweighs what they SAID, and what they
# said outweighs how they sounded. Booking a time is a commitment; sounding
# enthusiastic costs nothing.
SCORE_WEIGHTS = {
    "booked_appointment":   45,   # committed to a time - the strongest signal
    "requested_callback":   15,   # asked US to call back; auto-retries excluded
    "engagement_serious":   25,
    "engagement_casual":   -10,   # pleasant but not pursuing it - the time-passers
    "engagement_none":     -35,
    "interest_hot":         15,
    "interest_warm":         7,
    "interest_cold":       -15,
    "asked_many_topics":    10,   # 3+ subjects: doing real research
    "asked_some_topics":     5,
    "long_conversation":    10,   # 2min+: they stayed and engaged
    "medium_conversation":   5,
    "very_short_call":     -10,   # under 20s: hung up
    "is_parent":             5,   # the actual decision maker
    "wrong_number":        -40,
}


def _score_contact(contact, booked: bool, callback: bool, analysis: dict, duration: float):
    """
    Returns (score 0-100, [human-readable reasons]).

    Reasons come back with the number because a bare score invites exactly the
    wrong behaviour - blind trust or blanket dismissal. Seeing "booked an
    appointment (+45), asked about 4 different things (+10)" makes it checkable.
    """
    score = 0
    reasons = []

    def add(key, text):
        nonlocal score
        pts = SCORE_WEIGHTS[key]
        score += pts
        reasons.append("%s (%+d)" % (text, pts))

    # Do-not-call is absolute: no pile of positive signals can override somebody
    # explicitly asking not to be contacted again.
    if contact.status == "DoNotCall":
        return 0, ["asked not to be contacted"]

    if booked:
        add("booked_appointment", "booked an appointment")
    if callback:
        add("requested_callback", "asked to be called back")

    if analysis:
        engagement = (analysis.get("engagement_quality") or "").strip()
        if engagement == "Serious":
            add("engagement_serious", "engaged seriously")
        elif engagement == "Casual":
            add("engagement_casual", "engaged only casually")
        elif engagement == "NotInterested":
            add("engagement_none", "said they are not interested")

        interest = (analysis.get("interest_level") or "").strip()
        if interest == "Hot":
            add("interest_hot", "sounded very interested")
        elif interest == "Warm":
            add("interest_warm", "sounded fairly interested")
        elif interest == "Cold":
            add("interest_cold", "sounded uninterested")

        topics = [x for x in (analysis.get("topics_discussed") or "").split(",")
                  if x.strip() and x.strip().lower() != "none"]
        if len(topics) >= 3:
            add("asked_many_topics", "asked about %d different things" % len(topics))
        elif topics:
            add("asked_some_topics", "asked about %d thing(s)" % len(topics))

        caller_type = (analysis.get("caller_type") or "").strip()
        if caller_type == "Parent":
            add("is_parent", "spoke to the parent")
        elif caller_type == "WrongNumber":
            add("wrong_number", "wrong number")

    if duration:
        if duration >= 120:
            add("long_conversation", "talked for %ds" % int(duration))
        elif duration >= 45:
            add("medium_conversation", "talked for %ds" % int(duration))
        elif duration < 20:
            add("very_short_call", "call lasted seconds")

    return max(0, min(100, score)), reasons


def _band(score: int, has_signal: bool, analysis: dict, booked: bool, callback: bool, answered: bool):
    """
    Score -> the label people actually read.

    The score alone is not allowed to decide this, for three reasons found by
    running it over real data:

    1. A BOOKED APPOINTMENT IS ALWAYS HOT. Someone who commits to a time is the
       best lead you have, whatever else is missing. Scored purely on points, a
       booking with no analysis attached came to 55 and was labelled Warm --
       demoting a real commitment because a machine had not got round to
       listening to the call.

    2. NO ANALYSIS MEANS NO VERDICT, not a bad one. Every call made before
       analysis was switched on has no engagement or interest data, so it loses
       ~40 points it never had the chance to earn. Banding those on score alone
       labelled three-minute conversations "Not Interested" -- the exact
       mistake that buries a good lead. They are Unclassified until a real call
       is analysed.

    3. TIME PASS IS ABOUT ENGAGEMENT, NOT POINTS. A chatty caller who asks lots
       of questions can out-score a brief serious one, and calling them a Warm
       Lead is precisely what this feature exists to prevent.
    """
    if not has_signal:
        return "Not Reached"

    # Deeds first, and they are not overridable by the arithmetic.
    if booked:
        return "Hot Lead"

    if analysis:
        if (analysis.get("engagement_quality") or "") == "Casual" and score < 60:
            return "Time Pass"
        if score >= 60:
            return "Hot Lead"
        if score >= 30:
            return "Warm Lead"
        return "Not Interested"

    # No analysis: judge only on what we can actually observe.
    if callback:
        return "Warm Lead"
    if answered:
        return "Unclassified"
    return "Not Reached"


def compute_interest_levels(db: Session, contacts: list) -> dict:
    """Label-only view; compute_lead_scores has the score and the reasoning."""
    return {cid: v["classification"] for cid, v in compute_lead_scores(db, contacts).items()}


def compute_lead_scores(db: Session, contacts: list) -> dict:
    """
    {contact_id: {score, classification, reasons}} for a page of contacts.

    Four batched queries for the whole page regardless of size, never per row.
    """
    import json as _json
    from src.db import Appointment

    ids = [c.id for c in contacts]
    if not ids:
        return {}

    booked = {
        r[0] for r in db.query(Appointment.contact_id).filter(
            Appointment.contact_id.in_(ids), Appointment.status == "Booked"
        ).all()
    }
    # ONLY callbacks the caller asked for. The system schedules its own
    # auto-retries when a call goes unanswered (call_type "Reminder"), and
    # scoring those would reward somebody for never picking up the phone.
    callbacks = {
        r[0] for r in db.query(ScheduledCallback.contact_id).filter(
            ScheduledCallback.contact_id.in_(ids),
            ScheduledCallback.status.in_(["Scheduled", "Triggering"]),
            ScheduledCallback.call_type != "Reminder",
        ).all()
    }

    latest_analysis, longest_call, answered = {}, {}, set()
    rows = (
        db.query(CallAttempt.contact_id, CallAttempt.analysis_json, CallAttempt.duration_sec)
        .filter(CallAttempt.contact_id.in_(ids))
        .order_by(CallAttempt.started_at.asc())
        .all()
    )
    for contact_id, raw, duration in rows:
        if duration and duration > longest_call.get(contact_id, 0):
            longest_call[contact_id] = duration
        if duration and duration > 5:
            answered.add(contact_id)
        if raw:
            try:
                parsed = _json.loads(raw)
                if isinstance(parsed, dict) and parsed:
                    latest_analysis[contact_id] = parsed
            except (ValueError, TypeError):
                pass

    out = {}
    for c in contacts:
        analysis = latest_analysis.get(c.id)
        duration = longest_call.get(c.id, 0)
        has_signal = bool(analysis) or c.id in booked or c.id in callbacks or c.id in answered
        if not has_signal:
            out[c.id] = {"score": 0, "classification": "Not Reached", "reasons": ["not reached yet"]}
            continue
        score, reasons = _score_contact(c, c.id in booked, c.id in callbacks, analysis, duration)
        out[c.id] = {
            "score": score,
            "classification": _band(
                score, has_signal, analysis,
                c.id in booked, c.id in callbacks, c.id in answered,
            ),
            "reasons": reasons,
        }
    return out



def persist_lead_scores(db: Session, contacts: list) -> dict:
    """
    Recompute and STORE the score for these contacts.

    Called whenever something that feeds a score changes — a call is analysed,
    an appointment is booked, a callback is requested. Storing it is what makes
    "show me the hottest leads" an indexed SQL query over one page instead of a
    Python pass over every lead the school has ever had.

    Deliberately scoped to the contacts handed in. Never recompute the whole
    table: at 10,000 leads a day that is the exact operation that would make
    the dashboard unusable.
    """
    from datetime import datetime as _dt

    scored = compute_lead_scores(db, contacts)
    now = _dt.utcnow()
    for c in contacts:
        s = scored.get(c.id)
        if not s:
            continue
        if c.lead_score != s["score"] or c.lead_classification != s["classification"]:
            c.lead_score = s["score"]
            c.lead_classification = s["classification"]
            c.lead_scored_at = now
    db.commit()
    return scored


def rescore_contact(db: Session, contact_id: str):
    """Rescore one contact after a call, booking or callback. Never raises —
    a scoring failure must not break the webhook that triggered it."""
    try:
        contact = db.query(Contact).filter(Contact.id == contact_id).first()
        if contact:
            persist_lead_scores(db, [contact])
    except Exception as e:
        print(f"[SCORING] Could not rescore contact {contact_id}: {e}")


@router.get("")
def get_contacts(
    status: str = None,
    batchId: str = None,
    search: str = None,
    interest: str = None,
    page: int = 1,
    page_size: int = 50,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """
    A PAGE of leads, ranked best-first.

    Filtering, ranking and paging all happen in SQL against the stored
    lead_score. The previous version returned every lead and sorted them in
    Python: 8.7 KB for 20 leads, which is roughly 4 MB per page load at 10,000
    and grows every single day. A school doing 1,000-10,000 calls a day would
    have made that unusable within a week.
    """
    query = db.query(Contact)
    if current_user.get("school_id"):
        query = query.filter(Contact.school_id == current_user["school_id"])
    if status:
        query = query.filter(Contact.status == status)
    if batchId:
        query = query.filter(Contact.batch_id == batchId)
    if interest:
        query = query.filter(Contact.lead_classification == interest.strip())
    if search:
        query = query.filter(
            Contact.name.ilike(f"%{search}%") |
            Contact.phone_number.ilike(f"%{search}%")
        )

    total = query.count()

    page = max(1, page)
    page_size = max(1, min(page_size, 200))   # a caller cannot ask for everything
    rows = (
        query.order_by(Contact.lead_score.desc(), Contact.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )

    # Only this page is scored, so the reasons stay fresh without touching the
    # rest of the table.
    scored = compute_lead_scores(db, rows)

    items = [
        {
            "id": c.id,
            "school_id": c.school_id,
            "batch_id": c.batch_id,
            "name": c.name,
            "phone_number": c.phone_number,
            "email": c.email,
            "notes": c.notes,
            "status": c.status,
            "interest_level": scored.get(c.id, {}).get("classification", c.lead_classification or "Not Reached"),
            "lead_score": scored.get(c.id, {}).get("score", c.lead_score or 0),
            "score_reasons": scored.get(c.id, {}).get("reasons", []),
            # Only the points actually learned, plus the count — a counselor
            # scanning the queue wants "14/20 known", not twenty nulls.
            "profile": profile_dict(c),
            "profile_completeness": completeness(c),
            "created_at": c.created_at.isoformat() if c.created_at else None,
            "updated_at": c.updated_at.isoformat() if c.updated_at else None,
            "assigned_counselor_id": c.assigned_counselor_id,
        }
        for c in rows
    ]

    return {
        "items": items,
        "total": total,
        "page": page,
        "page_size": page_size,
        "pages": (total + page_size - 1) // page_size,
    }


@router.get("/stats")
def get_contact_stats(
    batchId: str = None,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """
    Counts by status for the whole tenant — the numbers on the dashboard tiles
    and the campaign summary.

    These used to be derived on the client by fetching every contact and
    calling .filter() over the array. Once GET /contacts became paginated that
    became both wrong and unfixable from the client: the page cap is 200, so a
    school with 10,000 leads would have shown "200 Total Leads" and a
    "Completed" count drawn from whichever 200 happened to be on page one.
    Wrong numbers that look plausible are worse than a crash, so the counts are
    computed in SQL where the whole table is visible.

    MUST STAY DEFINED ABOVE GET /{id} — FastAPI matches in declaration order,
    and /{id} would otherwise swallow "stats" as a contact id.
    """
    from sqlalchemy import func

    query = db.query(Contact.status, func.count(Contact.id))
    if current_user.get("school_id"):
        query = query.filter(Contact.school_id == current_user["school_id"])
    if batchId:
        query = query.filter(Contact.batch_id == batchId)

    by_status = {status or "Unknown": count for status, count in query.group_by(Contact.status).all()}

    return {
        "total": sum(by_status.values()),
        "by_status": by_status,
        # Spelled out so the client never has to know the status vocabulary.
        "completed": by_status.get("Completed", 0),
        "calling": by_status.get("Calling", 0),
        "pending": by_status.get("Pending", 0),
        "needs_reschedule": by_status.get("NeedsReschedule", 0),
        "scheduled": by_status.get("Scheduled", 0),
        "failed": by_status.get("Failed", 0),
    }


from src.db import Counselor

@router.get("/counselors/all")
def get_counselors(
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    school_id = resolve_school_id(db, current_user)
    counselors = db.query(Counselor).filter(Counselor.school_id == school_id).all()
    return [{"id": c.id, "name": c.name, "email": c.email, "phone_number": c.phone_number} for c in counselors]

class CounselorCreatePayload(BaseModel):
    name: str
    email: str
    phone_number: str | None = None

@router.post("/counselors")
def create_counselor(
    payload: CounselorCreatePayload,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    school_id = resolve_school_id(db, current_user)
    
    existing = db.query(Counselor).filter(Counselor.school_id == school_id, Counselor.email == payload.email).first()
    if existing:
        raise HTTPException(status_code=400, detail="Counselor with this email already exists")

    temp_password = None
    from src import cognito
    if cognito.cognito_enabled():
        try:
            temp_password = cognito.create_school_user(payload.email, school_id)
        except Exception as e:
            print(f"[COUNSELOR ONBOARD] Cognito account creation failed: {e}")
            raise HTTPException(status_code=400, detail=f"Failed to create login account: {str(e)}")

    new_counselor = Counselor(
        school_id=school_id,
        name=payload.name,
        email=payload.email,
        phone_number=payload.phone_number
    )
    db.add(new_counselor)
    db.commit()
    db.refresh(new_counselor)
    return {
        "success": True, 
        "counselor": {"id": new_counselor.id, "name": new_counselor.name, "email": new_counselor.email},
        "temp_password": temp_password
    }

@router.delete("/counselors/{id}")
def delete_counselor(
    id: str,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    school_id = resolve_school_id(db, current_user)
    counselor = db.query(Counselor).filter(Counselor.id == id, Counselor.school_id == school_id).first()
    if not counselor:
        raise HTTPException(status_code=404, detail="Counselor not found")
    
    from src import cognito
    if cognito.cognito_enabled():
        try:
            cognito.delete_school_user(counselor.email)
        except Exception as e:
            print(f"[COUNSELOR DELETION] Cognito account deletion failed: {e}")

    db.delete(counselor)
    db.commit()
    return {"success": True, "message": "Counselor removed successfully"}

@router.post("/counselors/auto-assign")
def auto_assign_contacts(
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    school_id = resolve_school_id(db, current_user)
    
    counselors = db.query(Counselor).filter(Counselor.school_id == school_id).all()
    if not counselors:
        raise HTTPException(status_code=400, detail="No onboarded counselors available for assignment")
    
    unassigned_contacts = db.query(Contact).filter(
        Contact.school_id == school_id,
        Contact.assigned_counselor_id.is_(None)
    ).all()
    
    if not unassigned_contacts:
        return {"success": True, "message": "All contacts are already assigned", "assigned_count": 0}
        
    counselor_count = len(counselors)
    for idx, contact in enumerate(unassigned_contacts):
        contact.assigned_counselor_id = counselors[idx % counselor_count].id
        
    db.commit()
    return {"success": True, "message": f"Successfully auto-assigned {len(unassigned_contacts)} leads", "assigned_count": len(unassigned_contacts)}



@router.get("/{id}")
def get_contact_history(
    id: str,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    contact = db.query(Contact).filter(Contact.id == id).first()
    if not contact:
        raise HTTPException(status_code=404, detail="Contact not found")
    if current_user.get("school_id") and contact.school_id != current_user["school_id"]:
        raise HTTPException(status_code=404, detail="Contact not found")

    attempts = db.query(CallAttempt).filter(CallAttempt.contact_id == id).order_by(CallAttempt.started_at.desc()).all()
    schedules = db.query(ScheduledCallback).filter(ScheduledCallback.contact_id == id).order_by(ScheduledCallback.scheduled_for.desc()).all()

    # Serialise attempts explicitly so the post-call analysis comes back as a
    # real object rather than the JSON string it is stored as. A malformed or
    # legacy value must not break the whole history view, so parsing failures
    # degrade to no analysis rather than raising.
    import json as _json

    def _attempt_dict(a):
        analysis = None
        if a.analysis_json:
            try:
                parsed = _json.loads(a.analysis_json)
                if isinstance(parsed, dict) and parsed:
                    analysis = parsed
            except (ValueError, TypeError):
                analysis = None
        return {
            "id": a.id,
            "attempt_number": a.attempt_number,
            "started_at": a.started_at.isoformat() if a.started_at else None,
            "ended_at": a.ended_at.isoformat() if a.ended_at else None,
            "outcome": a.outcome,
            "duration_sec": a.duration_sec,
            "transcript": a.transcript,
            "summary": a.summary,
            "recording_url": a.recording_url,
            "callback_raw_text": a.callback_raw_text,
            "user_sentiment": a.user_sentiment,
            "call_successful": a.call_successful,
            "analysis": analysis,
            "detected_topics": [x for x in (a.detected_topics or "").split(",") if x],
        }

    # The lead's standing judgement, so the drawer answers "is this person
    # worth my time?" without the reader having to reconstruct it from a list
    # of calls.
    scored = compute_lead_scores(db, [contact]).get(contact.id, {})

    # Every topic this person has ever raised, across all their calls — one
    # call's topics say what they asked that day, this says what they care about.
    all_topics = []
    for a in attempts:
        for label in (a.detected_topics or "").split(","):
            if label and label not in all_topics:
                all_topics.append(label)

    return {
        "contact": contact,
        "lead_score": scored.get("score", 0),
        "classification": scored.get("classification", "Not Reached"),
        "score_reasons": scored.get("reasons", []),
        # What the agent learned about the family, mid-call. Only the points
        # actually captured — see profile.py.
        "profile": profile_dict(contact),
        "profile_completeness": completeness(contact),
        "topics_asked": all_topics,
        "attempts": [_attempt_dict(a) for a in attempts],
        "schedules": schedules
    }

@router.delete("/{id}")
def delete_contact(
    id: str,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    contact = db.query(Contact).filter(Contact.id == id).first()
    if not contact:
        raise HTTPException(status_code=404, detail="Contact not found")
    if current_user.get("school_id") and contact.school_id != current_user["school_id"]:
        raise HTTPException(status_code=404, detail="Contact not found")
    
    db.delete(contact)
    db.commit()
    return {"success": True, "message": "Contact deleted"}



class ContactUpdatePayload(BaseModel):
    notes: str | None = None
    email: str | None = None
    name: str | None = None
    assigned_counselor_id: str | None = None

@router.patch("/{id}")
def update_contact(
    id: str,
    payload: ContactUpdatePayload,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    contact = db.query(Contact).filter(Contact.id == id).first()
    if not contact:
        raise HTTPException(status_code=404, detail="Contact not found")
    if current_user.get("school_id") and contact.school_id != current_user["school_id"]:
        raise HTTPException(status_code=404, detail="Contact not found")
    
    if payload.notes is not None:
        contact.notes = payload.notes
    if payload.email is not None:
        contact.email = payload.email
    if payload.name is not None:
        contact.name = payload.name
    if payload.assigned_counselor_id is not None:
        if payload.assigned_counselor_id.lower() in ("none", "", "null"):
            contact.assigned_counselor_id = None
        else:
            contact.assigned_counselor_id = payload.assigned_counselor_id

    db.commit()
    db.refresh(contact)
    return {"success": True, "contact": {"id": contact.id, "notes": contact.notes, "email": contact.email, "name": contact.name, "assigned_counselor_id": contact.assigned_counselor_id}}


