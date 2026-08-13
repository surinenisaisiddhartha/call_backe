import uuid
from datetime import datetime, date, timedelta
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional, List

from src.db import get_db, ClassBooking, ClassType
from src.routers.contacts import resolve_school_id
from src.routers.auth import get_current_user

router = APIRouter(prefix="/api/classes", tags=["Classes"])

# Default 4 class types seeded per school
DEFAULT_CLASS_TYPES = [
    {"name": "Music",      "description": "Vocals, keyboard or guitar — one-to-one.", "icon": "music",  "color": "indigo", "fee": 500, "sort_order": 0},
    {"name": "Dance",      "description": "Classical and contemporary styles.",        "icon": "dance",  "color": "pink",   "fee": 500, "sort_order": 1},
    {"name": "Art & Craft","description": "Sketching, painting and design basics.",   "icon": "art",    "color": "amber",  "fee": 500, "sort_order": 2},
    {"name": "Coding",     "description": "Beginner programming and robotics.",       "icon": "coding", "color": "green",  "fee": 500, "sort_order": 3},
]

TIME_SLOTS = ["18:00", "19:00", "20:00", "21:00"]


def _seed_defaults(db: Session, school_id: str):
    """Seed the 4 default class types if none exist for this school."""
    count = db.query(ClassType).filter(ClassType.school_id == school_id).count()
    if count == 0:
        for d in DEFAULT_CLASS_TYPES:
            ct = ClassType(school_id=school_id, **d)
            db.add(ct)
        db.commit()


def _serialize_type(ct: ClassType) -> dict:
    return {
        "id": ct.id,
        "name": ct.name,
        "description": ct.description or "",
        "icon": ct.icon or "book",
        "color": ct.color or "indigo",
        "fee": ct.fee,
        "duration_minutes": ct.duration_minutes,
        "max_per_slot": ct.max_per_slot,
        "is_active": ct.is_active,
        "sort_order": ct.sort_order,
    }


def _serialize_booking(b: ClassBooking) -> dict:
    return {
        "id": b.id,
        "class_type_id": b.class_type_id,
        "class_type": b.class_type,
        "booked_date": b.booked_date,
        "booked_time": b.booked_time,
        "student_name": b.student_name,
        "phone_number": b.phone_number,
        "email": b.email,
        "notes": b.notes,
        "fee": b.fee,
        "status": b.status,
        "created_at": b.created_at.isoformat() if b.created_at else None,
    }


# ── Class Types CRUD ────────────────────────────────────────────────────────

class ClassTypePayload(BaseModel):
    name: str
    description: Optional[str] = ""
    icon: Optional[str] = "book"
    color: Optional[str] = "indigo"
    fee: Optional[int] = 500
    duration_minutes: Optional[int] = 60
    max_per_slot: Optional[int] = 4
    is_active: Optional[bool] = True
    sort_order: Optional[int] = 0


@router.get("/types")
def get_class_types(
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    school_id = resolve_school_id(db, current_user)
    _seed_defaults(db, school_id)
    types = db.query(ClassType).filter(
        ClassType.school_id == school_id
    ).order_by(ClassType.sort_order, ClassType.name).all()
    return [_serialize_type(t) for t in types]


@router.post("/types")
def create_class_type(
    payload: ClassTypePayload,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    school_id = resolve_school_id(db, current_user)
    ct = ClassType(
        school_id=school_id,
        name=payload.name.strip(),
        description=payload.description,
        icon=payload.icon or "book",
        color=payload.color or "indigo",
        fee=payload.fee or 500,
        duration_minutes=payload.duration_minutes or 60,
        max_per_slot=payload.max_per_slot or 4,
        is_active=payload.is_active if payload.is_active is not None else True,
        sort_order=payload.sort_order or 0,
    )
    db.add(ct)
    db.commit()
    db.refresh(ct)
    return _serialize_type(ct)


@router.put("/types/{type_id}")
def update_class_type(
    type_id: str,
    payload: ClassTypePayload,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    school_id = resolve_school_id(db, current_user)
    ct = db.query(ClassType).filter(
        ClassType.id == type_id,
        ClassType.school_id == school_id
    ).first()
    if not ct:
        raise HTTPException(status_code=404, detail="Class type not found")

    ct.name = payload.name.strip()
    ct.description = payload.description
    ct.icon = payload.icon or ct.icon
    ct.color = payload.color or ct.color
    ct.fee = payload.fee if payload.fee is not None else ct.fee
    ct.duration_minutes = payload.duration_minutes if payload.duration_minutes is not None else ct.duration_minutes
    ct.max_per_slot = payload.max_per_slot if payload.max_per_slot is not None else ct.max_per_slot
    ct.is_active = payload.is_active if payload.is_active is not None else ct.is_active
    ct.sort_order = payload.sort_order if payload.sort_order is not None else ct.sort_order
    db.commit()
    db.refresh(ct)
    return _serialize_type(ct)


@router.delete("/types/{type_id}")
def delete_class_type(
    type_id: str,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    school_id = resolve_school_id(db, current_user)
    ct = db.query(ClassType).filter(
        ClassType.id == type_id,
        ClassType.school_id == school_id
    ).first()
    if not ct:
        raise HTTPException(status_code=404, detail="Class type not found")
    db.delete(ct)
    db.commit()
    return {"success": True}


# ── Availability ────────────────────────────────────────────────────────────

@router.get("/availability")
def get_availability(
    days: int = Query(21, ge=1, le=60),
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    school_id = resolve_school_id(db, current_user)
    today = date.today()
    result = []

    for i in range(days):
        d = today + timedelta(days=i)
        date_str = d.strftime("%Y-%m-%d")
        day_label = d.strftime("%a %d %b").replace(" 0", " ")

        slots = []
        for t in TIME_SLOTS:
            count = db.query(ClassBooking).filter(
                ClassBooking.school_id == school_id,
                ClassBooking.booked_date == date_str,
                ClassBooking.booked_time == t,
                ClassBooking.status != "cancelled"
            ).count()
            free = max(0, 4 - count)
            slots.append({
                "time": t,
                "booked": count,
                "free": free,
                "available": free > 0
            })

        result.append({
            "date": date_str,
            "label": day_label,
            "total_free": sum(s["free"] for s in slots),
            "slots": slots
        })

    return result


# ── Stats ───────────────────────────────────────────────────────────────────

@router.get("/stats")
def get_stats(
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    school_id = resolve_school_id(db, current_user)
    today_str = date.today().strftime("%Y-%m-%d")

    upcoming = db.query(ClassBooking).filter(
        ClassBooking.school_id == school_id,
        ClassBooking.booked_date >= today_str,
        ClassBooking.status == "upcoming"
    ).count()

    all_upcoming = db.query(ClassBooking).filter(
        ClassBooking.school_id == school_id,
        ClassBooking.status == "upcoming"
    ).all()
    total_value = sum(b.fee for b in all_upcoming)

    slots_free = 0
    for t in TIME_SLOTS:
        count = db.query(ClassBooking).filter(
            ClassBooking.school_id == school_id,
            ClassBooking.booked_date == today_str,
            ClassBooking.booked_time == t,
            ClassBooking.status != "cancelled"
        ).count()
        if count < 4:
            slots_free += (4 - count)

    return {
        "upcoming_classes": upcoming,
        "awaiting_payment": 0,
        "slots_free_today": slots_free,
        "booked_value": total_value,
    }


# ── Bookings CRUD ───────────────────────────────────────────────────────────

class BookingPayload(BaseModel):
    class_type_id: str
    booked_date: str
    booked_time: str
    student_name: str
    phone_number: str
    email: Optional[str] = None
    notes: Optional[str] = None
    fee: Optional[int] = None


class BookingUpdatePayload(BaseModel):
    class_type_id: Optional[str] = None
    booked_date: Optional[str] = None
    booked_time: Optional[str] = None
    student_name: Optional[str] = None
    phone_number: Optional[str] = None
    email: Optional[str] = None
    notes: Optional[str] = None
    fee: Optional[int] = None
    status: Optional[str] = None


@router.get("/bookings")
def get_bookings(
    status: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    school_id = resolve_school_id(db, current_user)
    query = db.query(ClassBooking).filter(ClassBooking.school_id == school_id)
    if status:
        query = query.filter(ClassBooking.status == status)
    bookings = query.order_by(ClassBooking.booked_date, ClassBooking.booked_time).all()
    return [_serialize_booking(b) for b in bookings]


@router.post("/bookings")
def create_booking(
    payload: BookingPayload,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    school_id = resolve_school_id(db, current_user)

    ct = db.query(ClassType).filter(
        ClassType.id == payload.class_type_id,
        ClassType.school_id == school_id
    ).first()
    if not ct:
        raise HTTPException(status_code=404, detail="Class type not found")

    count = db.query(ClassBooking).filter(
        ClassBooking.school_id == school_id,
        ClassBooking.booked_date == payload.booked_date,
        ClassBooking.booked_time == payload.booked_time,
        ClassBooking.status != "cancelled"
    ).count()
    if count >= ct.max_per_slot:
        raise HTTPException(status_code=400, detail="This time slot is fully booked. Please choose another.")

    booking = ClassBooking(
        school_id=school_id,
        class_type_id=ct.id,
        class_type=ct.name,
        booked_date=payload.booked_date,
        booked_time=payload.booked_time,
        student_name=payload.student_name.strip(),
        phone_number=payload.phone_number.strip(),
        email=payload.email.strip() if payload.email else None,
        notes=payload.notes.strip() if payload.notes else None,
        fee=payload.fee if payload.fee is not None else ct.fee,
        status="upcoming"
    )
    db.add(booking)
    db.commit()
    db.refresh(booking)
    return _serialize_booking(booking)


@router.put("/bookings/{booking_id}")
def update_booking(
    booking_id: str,
    payload: BookingUpdatePayload,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    school_id = resolve_school_id(db, current_user)
    booking = db.query(ClassBooking).filter(
        ClassBooking.id == booking_id,
        ClassBooking.school_id == school_id
    ).first()
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")

    if payload.class_type_id:
        ct = db.query(ClassType).filter(ClassType.id == payload.class_type_id).first()
        if ct:
            booking.class_type_id = ct.id
            booking.class_type = ct.name
    if payload.booked_date is not None:
        booking.booked_date = payload.booked_date
    if payload.booked_time is not None:
        booking.booked_time = payload.booked_time
    if payload.student_name is not None:
        booking.student_name = payload.student_name.strip()
    if payload.phone_number is not None:
        booking.phone_number = payload.phone_number.strip()
    if payload.email is not None:
        booking.email = payload.email.strip() or None
    if payload.notes is not None:
        booking.notes = payload.notes.strip() or None
    if payload.fee is not None:
        booking.fee = payload.fee
    if payload.status is not None:
        booking.status = payload.status

    db.commit()
    db.refresh(booking)
    return _serialize_booking(booking)


@router.delete("/bookings/{booking_id}")
def cancel_booking(
    booking_id: str,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    school_id = resolve_school_id(db, current_user)
    booking = db.query(ClassBooking).filter(
        ClassBooking.id == booking_id,
        ClassBooking.school_id == school_id
    ).first()
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")
    booking.status = "cancelled"
    db.commit()
    return {"success": True}
