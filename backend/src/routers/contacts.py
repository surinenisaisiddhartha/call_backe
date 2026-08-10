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


CLASSIFICATIONS = ["HOT", "WARM", "COLD"]

# ── Weighted lead scoring ────────────────────────────────────────────────
# Eight parameters, each scored 0–100 independently, then combined via a
# fixed weight vector. The final weighted score (also 0–100) determines the
# classification:
#
#   75–100   → HOT
#   50–74.99 → WARM
#    0–49.99 → COLD
#
# The percentage determines the classification — never a single field like
# engagement_quality or interest_level on its own.

PARAM_WEIGHTS = {
    "appointment_conversion_intent": 0.25,
    "engagement_quality":            0.20,
    "interest_level":                0.15,
    "conversation_depth":            0.10,
    "caller_relevance":              0.10,
    "admission_intent":              0.10,
    "requirement_fit":               0.05,
    "follow_up_intent":              0.05,
}


def _score_appointment(booked: bool, callback: bool, analysis: dict, contact) -> int:
    """Appointment / Conversion Intent — 25%."""
    if contact.status == "DoNotCall":
        return 0
    if booked:
        return 100
    # Check for explicit campus visit / appointment request in analysis
    next_step = (analysis.get("recommended_next_step") or "").lower() if analysis else ""
    synopsis = (analysis.get("call_synopsis") or "").lower() if analysis else ""
    combined = next_step + " " + synopsis
    if any(kw in combined for kw in ("visit", "appointment", "campus tour", "schedule a visit")):
        return 90
    if callback:
        return 75
    # Check for admission info requests in analysis
    if analysis:
        topics = (analysis.get("topics_discussed") or "").lower()
        if any(kw in topics for kw in ("admissions", "fees", "curriculum")):
            return 65
        interest = (analysis.get("interest_level") or "").strip()
        if interest in ("Hot", "Warm"):
            return 50
        engagement = (analysis.get("engagement_quality") or "").strip()
        if engagement in ("Serious", "Casual"):
            return 35
    # Wrong number or caller not available
    caller_type = (analysis.get("caller_type") or "").strip() if analysis else ""
    if caller_type == "WrongNumber":
        return 0
    return 15


def _score_engagement(analysis: dict) -> int:
    """Engagement Quality — 20%."""
    if not analysis:
        return None  # missing signal
    engagement = (analysis.get("engagement_quality") or "").strip()
    return {"Serious": 100, "Casual": 50, "Unclear": 30, "NotInterested": 0}.get(engagement, 30)


def _score_interest(analysis: dict) -> int:
    """Interest Level — 15%."""
    if not analysis:
        return None  # missing signal
    interest = (analysis.get("interest_level") or "").strip()
    return {"Hot": 100, "Warm": 65, "Cold": 20, "Unclear": 30}.get(interest, 30)


def _score_conversation_depth(analysis: dict, duration: float, detected_topics: str) -> int:
    """Conversation Depth — 10%. Combines topics + duration.

    Returns None (missing signal) when there is no evidence of a real
    conversation — e.g. the user never spoke, all calls were NoAnswer /
    IncompleteHangup, etc.  The caller-side filtering now happens upstream
    in compute_lead_scores, so by the time we get here the duration and
    topics already exclude non-engaged calls.
    """
    # Topic count from both LLM analysis and keyword detection
    topic_count = 0
    if analysis:
        topics = [x for x in (analysis.get("topics_discussed") or "").split(",")
                  if x.strip() and x.strip().lower() != "none"]
        topic_count = max(topic_count, len(topics))
    if detected_topics:
        kw_topics = [x for x in detected_topics.split(",") if x.strip()]
        topic_count = max(topic_count, len(kw_topics))

    # No topics AND no meaningful duration → missing signal
    if topic_count == 0 and (not duration or duration < 10):
        return None

    if topic_count >= 4:
        topic_score = 100
    elif topic_count == 3:
        topic_score = 85
    elif topic_count >= 1:
        topic_score = 65
    else:
        topic_score = 20

    # Duration adjusts the score — supportive, not dominant
    if duration and duration >= 120:
        duration_factor = 1.0      # strong support
    elif duration and duration >= 45:
        duration_factor = 0.85     # moderate
    elif duration and duration >= 20:
        duration_factor = 0.65     # low
    else:
        duration_factor = 0.40     # very low — but doesn't zero out good topics

    # Blend: topics are primary (70%), duration shapes it (30%)
    return int(topic_score * 0.70 + (duration_factor * 100) * 0.30)


def _score_caller_relevance(analysis: dict) -> int:
    """Caller Relevance — 10%."""
    if not analysis:
        return None  # missing signal
    caller_type = (analysis.get("caller_type") or "").strip()
    return {"Parent": 100, "Student": 75, "Other": 40,
            "NotAvailable": 20, "WrongNumber": 0}.get(caller_type, 40)


def _score_admission_intent(contact) -> int:
    """Admission Intent — 10%. Uses the 20-point profile captured mid-call."""
    score = 0
    signals = 0

    # decision_timeline
    timeline = getattr(contact, "decision_timeline", None)
    if timeline:
        signals += 1
        score += {"Immediate": 100, "ThisMonth": 85, "ThisQuarter": 70,
                  "NextYear": 45, "Unknown": 30}.get(timeline, 30)

    # admission_urgency
    urgency = getattr(contact, "admission_urgency", None)
    if urgency:
        signals += 1
        score += {"Urgent": 100, "Planned": 70, "JustExploring": 45,
                  "Unknown": 30}.get(urgency, 30)

    # campus_visit_interest — positive signal
    visit = getattr(contact, "campus_visit_interest", None)
    if visit:
        signals += 1
        score += {"Yes": 90, "AlreadyVisited": 80, "No": 20,
                  "Unknown": 30}.get(visit, 30)

    # decision_maker — Self/Both means they can act
    dm = getattr(contact, "decision_maker", None)
    if dm:
        signals += 1
        score += {"Self": 90, "Both": 80, "Spouse": 50,
                  "ExtendedFamily": 40, "Unknown": 30}.get(dm, 30)

    # competition_considered — actively comparing = serious
    comp = getattr(contact, "competition_considered", None)
    if comp and comp.lower() not in ("none", "n/a", "na", ""):
        signals += 1
        score += 75  # actively comparing schools is a positive signal

    if signals == 0:
        return None  # no profile data yet — missing signal
    return min(100, score // signals)


def _score_requirement_fit(contact) -> int:
    """Requirement / Fit — 5%. How much useful family info was established."""
    fit_fields = [
        "grade_sought", "academic_year", "board_preference", "locality",
        "current_school", "transport_needed", "boarding_needed",
        "special_requirements", "budget_band",
    ]
    filled = sum(1 for f in fit_fields
                 if getattr(contact, f, None) and str(getattr(contact, f)).lower() not in
                 ("unknown", "n/a", "na", "none"))

    if filled >= 7:
        return 100
    elif filled >= 5:
        return 75
    elif filled >= 3:
        return 50
    elif filled >= 1:
        return 25
    return None  # no info at all — missing signal


def _score_follow_up(callback: bool, contact, analysis: dict) -> int:
    """Follow-up Intent — 5%."""
    score = 0
    signals = 0

    if callback:
        signals += 1
        score += 100  # clear next action

    pref_time = getattr(contact, "preferred_contact_time", None)
    if pref_time and pref_time.lower() not in ("unknown", "n/a", "na", "none"):
        signals += 1
        score += 80  # willing to set a time

    pref_lang = getattr(contact, "language_preference", None)
    if pref_lang and pref_lang not in ("Unknown",):
        signals += 1
        score += 60  # shared language preference

    if analysis:
        next_step = (analysis.get("recommended_next_step") or "").strip()
        if next_step and next_step.lower() not in ("none", "n/a", ""):
            signals += 1
            score += 80

    if signals == 0:
        return None  # missing signal
    return min(100, score // signals)


def _classify(score: float) -> str:
    """Final classification from the weighted score — the ONLY rule."""
    if score >= 75:
        return "HOT"
    elif score >= 50:
        return "WARM"
    return "COLD"


def _generate_reason(param_scores: dict, weighted_breakdown: dict,
                     classification: str, missing_params: list) -> str:
    """Human-readable explanation of why this lead got its classification."""
    parts = []

    # Highlight the strongest contributors
    sorted_params = sorted(weighted_breakdown.items(), key=lambda x: x[1], reverse=True)
    top = [p for p, w in sorted_params[:3] if w > 0]

    label_map = {
        "appointment_conversion_intent": "conversion intent",
        "engagement_quality": "engagement",
        "interest_level": "interest",
        "conversation_depth": "conversation depth",
        "caller_relevance": "caller relevance",
        "admission_intent": "admission intent",
        "requirement_fit": "requirement fit",
        "follow_up_intent": "follow-up intent",
    }

    if top:
        strengths = [label_map.get(p, p) for p in top]
        parts.append("Strong in: " + ", ".join(strengths))

    # Note weak areas
    weak = [label_map.get(p, p) for p, s in param_scores.items() if s is not None and s < 30]
    if weak:
        parts.append("Weak in: " + ", ".join(weak[:2]))

    if missing_params:
        parts.append(f"{len(missing_params)} parameter(s) had no data")

    if not parts:
        if classification == "COLD":
            parts.append("Limited engagement and conversion signals")
        elif classification == "WARM":
            parts.append("Moderate engagement and interest signals")
        else:
            parts.append("Strong engagement, interest, and conversion signals")

    return ". ".join(parts) + "."


def compute_interest_levels(db: Session, contacts: list) -> dict:
    """Label-only view; compute_lead_scores has the score and the reasoning."""
    return {cid: v["classification"] for cid, v in compute_lead_scores(db, contacts).items()}


def compute_lead_scores(db: Session, contacts: list) -> dict:
    """
    {contact_id: {lead_score, classification, parameter_scores,
                   weighted_score_breakdown, classification_reason}}

    Eight parameters, each scored 0–100 independently, combined via fixed
    weights. Missing analysis fields are handled by redistributing their
    weight across available parameters so the final score stays 0–100.

    Batched queries for the whole page — never one query per contact.
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
    # ONLY callbacks the caller asked for. Auto-retries (call_type "Reminder")
    # don't count — they reward not picking up the phone.
    callbacks = {
        r[0] for r in db.query(ScheduledCallback.contact_id).filter(
            ScheduledCallback.contact_id.in_(ids),
            ScheduledCallback.status.in_(["Scheduled", "Triggering"]),
            ScheduledCallback.call_type != "Reminder",
        ).all()
    }

    latest_analysis = {}
    longest_call = {}
    latest_detected_topics = {}
    # Outcomes that indicate the user never actually engaged in conversation.
    # Only "Answered" calls should contribute to scoring signals.
    _NON_ENGAGED = {"NoAnswer", "Busy", "Failed", "IncompleteHangup"}
    rows = (
        db.query(
            CallAttempt.contact_id, CallAttempt.analysis_json,
            CallAttempt.duration_sec, CallAttempt.detected_topics,
            CallAttempt.outcome,
        )
        .filter(CallAttempt.contact_id.in_(ids))
        .order_by(CallAttempt.started_at.asc())
        .all()
    )
    for contact_id, raw, duration, det_topics, outcome in rows:
        engaged = outcome not in _NON_ENGAGED
        # Duration & topics only count from calls where the user spoke
        if engaged and duration and duration > longest_call.get(contact_id, 0):
            longest_call[contact_id] = duration
        if engaged and det_topics:
            latest_detected_topics[contact_id] = det_topics
        # Analysis: still use the latest available — even a partial call
        # may have an LLM analysis (e.g. caller_type = WrongNumber)
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
        det_topics = latest_detected_topics.get(c.id, "")
        is_booked = c.id in booked
        is_callback = c.id in callbacks

        # Compute each parameter (None = missing signal)
        raw_scores = {
            "appointment_conversion_intent": _score_appointment(is_booked, is_callback, analysis, c),
            "engagement_quality":            _score_engagement(analysis),
            "interest_level":                _score_interest(analysis),
            "conversation_depth":            _score_conversation_depth(analysis, duration, det_topics),
            "caller_relevance":              _score_caller_relevance(analysis),
            "admission_intent":              _score_admission_intent(c),
            "requirement_fit":               _score_requirement_fit(c),
            "follow_up_intent":              _score_follow_up(is_callback, c, analysis),
        }

        # Separate available vs missing
        available = {k: v for k, v in raw_scores.items() if v is not None}
        missing = [k for k, v in raw_scores.items() if v is None]

        # Normalize weights so available parameters sum to 1.0
        if available:
            total_available_weight = sum(PARAM_WEIGHTS[k] for k in available)
            if total_available_weight > 0:
                scale = 1.0 / total_available_weight
            else:
                scale = 1.0

            weighted_breakdown = {}
            for k, v in available.items():
                weighted_breakdown[k] = round(v * PARAM_WEIGHTS[k] * scale, 2)
            # Fill missing with 0 for display
            for k in missing:
                weighted_breakdown[k] = 0.0

            final_score = round(sum(weighted_breakdown.values()), 2)
        else:
            # No data at all — score is 0
            weighted_breakdown = {k: 0.0 for k in PARAM_WEIGHTS}
            final_score = 0.0

        final_score = max(0.0, min(100.0, final_score))
        classification = _classify(final_score)

        # Parameter scores for display (None → 0 in output)
        param_scores = {k: (v if v is not None else 0) for k, v in raw_scores.items()}

        reason = _generate_reason(param_scores, weighted_breakdown, classification, missing)

        out[c.id] = {
            "score": final_score,
            "classification": classification,
            "reasons": [reason],
            "parameter_scores": param_scores,
            "weighted_score_breakdown": weighted_breakdown,
            "classification_reason": reason,
            "missing_params": missing,
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
            "interest_level": scored.get(c.id, {}).get("classification", c.lead_classification or "COLD"),
            "lead_score": scored.get(c.id, {}).get("score", c.lead_score or 0),
            "score_reasons": scored.get(c.id, {}).get("reasons", []),
            "parameter_scores": scored.get(c.id, {}).get("parameter_scores", {}),
            "weighted_score_breakdown": scored.get(c.id, {}).get("weighted_score_breakdown", {}),
            "classification_reason": scored.get(c.id, {}).get("classification_reason", ""),
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
    
    # Collect valid/active counselor IDs so we can detect orphaned assignments
    active_counselor_ids = {c.id for c in counselors}

    # Pick up (1) truly unassigned AND (2) assigned to a deleted counselor
    all_contacts = db.query(Contact).filter(Contact.school_id == school_id).all()
    needs_assignment = [
        c for c in all_contacts
        if c.assigned_counselor_id is None
        or c.assigned_counselor_id not in active_counselor_ids
    ]
    
    if not needs_assignment:
        return {"success": True, "message": "All contacts are already assigned to active counselors", "assigned_count": 0}
        
    counselor_count = len(counselors)
    for idx, contact in enumerate(needs_assignment):
        contact.assigned_counselor_id = counselors[idx % counselor_count].id
        
    db.commit()
    return {
        "success": True,
        "message": f"Successfully auto-assigned {len(needs_assignment)} leads across {counselor_count} counselors",
        "assigned_count": len(needs_assignment)
    }



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
        "classification": scored.get("classification", "COLD"),
        "score_reasons": scored.get("reasons", []),
        "parameter_scores": scored.get("parameter_scores", {}),
        "weighted_score_breakdown": scored.get("weighted_score_breakdown", {}),
        "classification_reason": scored.get("classification_reason", ""),
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
    status: str | None = None
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
    if payload.status is not None:
        contact.status = payload.status
    if payload.assigned_counselor_id is not None:
        if payload.assigned_counselor_id.lower() in ("none", "", "null"):
            contact.assigned_counselor_id = None
        else:
            contact.assigned_counselor_id = payload.assigned_counselor_id

    db.commit()
    db.refresh(contact)
    return {
        "success": True, 
        "contact": {
            "id": contact.id, 
            "notes": contact.notes, 
            "email": contact.email, 
            "name": contact.name, 
            "status": contact.status,
            "assigned_counselor_id": contact.assigned_counselor_id
        }
    }


