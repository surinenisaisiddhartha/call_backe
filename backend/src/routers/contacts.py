import io
import csv
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlalchemy.orm import Session
from src.db import get_db, Contact, UploadBatch, CallAttempt, ScheduledCallback
from src.routers.auth import get_current_user
import openpyxl

router = APIRouter(prefix="/api/contacts", tags=["Contacts"])

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

                if not name_val:
                    errors.append({"row": row_idx, "error": "Name is empty"})
                    continue
                if not phone_val:
                    errors.append({"row": row_idx, "error": "Phone number is empty"})
                    continue

                clean_phone = "".join(c for c in str(phone_val) if c.isdigit() or c == "+")
                if not clean_phone.startswith("+"):
                    if len(clean_phone) == 10:
                        clean_phone = "+91" + clean_phone
                    elif len(clean_phone) == 12 and clean_phone.startswith("91"):
                        clean_phone = "+" + clean_phone
                    else:
                        clean_phone = "+" + clean_phone

                # Check if phone number is on DoNotCall list
                existing_do_not_call = db.query(Contact).filter(
                    Contact.phone_number == clean_phone,
                    Contact.status == "DoNotCall"
                ).first()
                
                if existing_do_not_call:
                    errors.append({"row": row_idx, "error": f"Phone number {clean_phone} is on DoNotCall list"})
                    continue

                contacts.append({
                    "name": str(name_val).strip(),
                    "phone": clean_phone,
                    "email": str(email_val).strip() if email_val else None,
                    "notes": str(notes_val).strip() if notes_val else None
                })
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

                if not name_val:
                    errors.append({"row": row_idx, "error": "Name is empty"})
                    continue
                if not phone_val:
                    errors.append({"row": row_idx, "error": "Phone number is empty"})
                    continue

                clean_phone = "".join(c for c in str(phone_val) if c.isdigit() or c == "+")
                if not clean_phone.startswith("+"):
                    if len(clean_phone) == 10:
                        clean_phone = "+91" + clean_phone
                    elif len(clean_phone) == 12 and clean_phone.startswith("91"):
                        clean_phone = "+" + clean_phone
                    else:
                        clean_phone = "+" + clean_phone

                # Check if phone number is on DoNotCall list
                existing_do_not_call = db.query(Contact).filter(
                    Contact.phone_number == clean_phone,
                    Contact.status == "DoNotCall"
                ).first()
                
                if existing_do_not_call:
                    errors.append({"row": row_idx, "error": f"Phone number {clean_phone} is on DoNotCall list"})
                    continue

                contacts.append({
                    "name": str(name_val).strip(),
                    "phone": clean_phone,
                    "email": str(email_val).strip() if email_val else None,
                    "notes": str(notes_val).strip() if notes_val else None
                })

        if not contacts:
            raise HTTPException(status_code=400, detail="No valid rows found in file")

        # Insert upload batch record
        batch = UploadBatch(
            file_name=file.filename,
            total_contacts=len(contacts),
            uploaded_by=current_user.get("email", "admin")
        )
        db.add(batch)
        db.commit()
        db.refresh(batch)

        # Insert contacts
        success_count = 0
        for c in contacts:
            try:
                new_contact = Contact(
                    batch_id=batch.id,
                    name=c["name"],
                    phone_number=c["phone"],
                    email=c["email"],
                    notes=c["notes"],
                    status="Pending"
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
    batches = db.query(UploadBatch).order_by(UploadBatch.uploaded_at.desc()).all()
    result = []
    for b in batches:
        # Per-campaign status counts
        status_counts = db.query(Contact.status, func.count(Contact.id)).filter(
            Contact.batch_id == b.id
        ).group_by(Contact.status).all()
        counts = {s: c for s, c in status_counts}
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
    contact_ids = [c.id for c in db.query(Contact.id).filter(Contact.batch_id == batch_id).all()]
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


@router.get("")
def get_contacts(
    status: str = None,
    batchId: str = None,
    search: str = None,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    query = db.query(Contact)
    if status:
        query = query.filter(Contact.status == status)
    if batchId:
        query = query.filter(Contact.batch_id == batchId)
    if search:
        query = query.filter(
            Contact.name.ilike(f"%{search}%") | 
            Contact.phone_number.ilike(f"%{search}%")
        )

    contacts = query.order_by(Contact.created_at.desc()).all()
    return contacts

@router.get("/{id}")
def get_contact_history(
    id: str,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    contact = db.query(Contact).filter(Contact.id == id).first()
    if not contact:
        raise HTTPException(status_code=404, detail="Contact not found")

    attempts = db.query(CallAttempt).filter(CallAttempt.contact_id == id).order_by(CallAttempt.started_at.desc()).all()
    schedules = db.query(ScheduledCallback).filter(ScheduledCallback.contact_id == id).order_by(ScheduledCallback.scheduled_for.desc()).all()

    return {
        "contact": contact,
        "attempts": attempts,
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
    
    db.delete(contact)
    db.commit()
    return {"success": True, "message": "Contact deleted"}
