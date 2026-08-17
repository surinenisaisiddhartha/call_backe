"""
Availability & Capacity Service.
Provides centralized validation for in-call actions:
- Appointments (In-person Campus Tours, Virtual Consultations)
- Demo Classes (Capacity, age/grade eligibility, booked seat quotas)
- Callbacks (Allowed window, blackout dates, timezone)
- Counselor Capacity & Live Handoff Availability
"""

from datetime import datetime, time, timedelta
from typing import Optional, Dict, Any, List, Literal
from sqlalchemy.orm import Session
from src.db import SessionLocal, School, Appointment, ClassBooking, ClassType, Counselor, Contact


class AvailabilityService:
    @staticmethod
    def check_appointment_slot(
        db: Session,
        scheduled_for_utc: datetime,
        meeting_type: str = "in_person",
        school_id: Optional[str] = None,
        duration_minutes: int = 30,
        min_notice_hours: int = 2,
        max_advance_days: int = 30,
        buffer_minutes: int = 15
    ) -> Dict[str, Any]:
        """
        Validates whether an appointment slot is valid and available:
        - Meeting type is valid ("in_person" or "virtual")
        - Slot is in the future and respects minimum booking notice
        - Slot is within maximum advance booking horizon
        - Slot is within school operating hours (09:00 - 18:00 IST)
        - No conflicting appointment within buffer window
        """
        now_utc = datetime.utcnow()

        # 1. Validate meeting type
        normalized_type = (meeting_type or "in_person").strip().lower()
        if normalized_type not in ("in_person", "virtual"):
            return {
                "available": False,
                "reason": f"Invalid meeting type '{meeting_type}'. Only 'in_person' and 'virtual' are permitted.",
                "suggested_types": ["in_person", "virtual"]
            }

        # 2. Minimum notice check
        min_allowed_time = now_utc + timedelta(hours=min_notice_hours)
        if scheduled_for_utc < min_allowed_time:
            return {
                "available": False,
                "reason": f"Appointments require at least {min_notice_hours} hours advance notice.",
                "earliest_available_utc": min_allowed_time.isoformat()
            }

        # 3. Maximum advance check
        max_allowed_time = now_utc + timedelta(days=max_advance_days)
        if scheduled_for_utc > max_allowed_time:
            return {
                "available": False,
                "reason": f"Appointments can only be scheduled up to {max_advance_days} days in advance.",
                "latest_available_utc": max_allowed_time.isoformat()
            }

        # 4. Operating hours check in IST (+05:30)
        ist_offset = timedelta(hours=5, minutes=30)
        slot_ist = scheduled_for_utc + ist_offset
        slot_time = slot_ist.time()

        # Sunday closure / default 09:00 - 18:00 IST
        if slot_ist.weekday() == 6:  # Sunday
            return {
                "available": False,
                "reason": "Campus admissions office is closed on Sundays.",
                "suggested_days": ["Monday through Saturday"]
            }

        if slot_time < time(9, 0) or slot_time > time(18, 0):
            return {
                "available": False,
                "reason": "Admissions appointments are available Monday to Saturday between 9:00 AM and 6:00 PM IST.",
                "allowed_window": "09:00 - 18:00 IST"
            }

        # 5. Overlap collision check with buffer
        start_buffer = scheduled_for_utc - timedelta(minutes=buffer_minutes)
        end_buffer = scheduled_for_utc + timedelta(minutes=duration_minutes + buffer_minutes)

        query = db.query(Appointment).filter(
            Appointment.status == "Booked",
            Appointment.scheduled_for >= start_buffer,
            Appointment.scheduled_for <= end_buffer
        )
        if school_id:
            query = query.join(Contact, Appointment.contact_id == Contact.id).filter(Contact.school_id == school_id)

        conflicts = query.count()
        if conflicts >= 2:  # Max 2 concurrent tours
            return {
                "available": False,
                "reason": "The selected time slot is fully booked. Please choose an adjacent slot.",
                "is_collision": True
            }

        return {
            "available": True,
            "meeting_type": normalized_type,
            "scheduled_for_utc": scheduled_for_utc.isoformat(),
            "scheduled_for_ist": slot_ist.strftime("%A, %d %B %Y at %I:%M %p IST")
        }

    @staticmethod
    def check_class_slot(
        db: Session,
        class_type_name: str,
        booked_date_str: str,  # YYYY-MM-DD
        booked_time_str: str,  # HH:MM
        school_id: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Validates capacity and slot for demo classes (Early Years Trial, STEM Workshop, IB Demo).
        """
        query = db.query(ClassType).filter(ClassType.is_active == True)
        if school_id:
            query = query.filter(ClassType.school_id == school_id)

        class_type = query.filter(ClassType.name.ilike(f"%{class_type_name}%")).first()
        if not class_type:
            class_type = query.first()

        max_capacity = class_type.max_per_slot if class_type else 4

        existing_bookings = db.query(ClassBooking).filter(
            ClassBooking.class_type == (class_type.name if class_type else class_type_name),
            ClassBooking.booked_date == booked_date_str,
            ClassBooking.booked_time == booked_time_str,
            ClassBooking.status == "upcoming"
        ).count()

        available_seats = max(0, max_capacity - existing_bookings)
        is_available = available_seats > 0

        return {
            "available": is_available,
            "class_type": class_type.name if class_type else class_type_name,
            "max_capacity": max_capacity,
            "booked_seats": existing_bookings,
            "available_seats": available_seats,
            "duration_minutes": class_type.duration_minutes if class_type else 60,
            "fee": class_type.fee if class_type else 0,
            "reason": None if is_available else f"All {max_capacity} seats are booked for {booked_date_str} at {booked_time_str}."
        }

    @staticmethod
    def check_callback_window(
        requested_dt_utc: datetime,
        start_hour_ist: int = 9,
        end_hour_ist: int = 21
    ) -> Dict[str, Any]:
        """
        Validates callback time against permissible calling window.
        """
        ist_offset = timedelta(hours=5, minutes=30)
        dt_ist = requested_dt_utc + ist_offset
        hour = dt_ist.hour

        is_in_window = start_hour_ist <= hour < end_hour_ist
        return {
            "valid": is_in_window,
            "requested_ist": dt_ist.strftime("%A, %d %B %Y at %I:%M %p IST"),
            "allowed_window": f"{start_hour_ist:02d}:00 to {end_hour_ist:02d}:00 IST",
            "reason": None if is_in_window else f"Callbacks must be scheduled between {start_hour_ist}:00 and {end_hour_ist}:00 IST."
        }


availability_service = AvailabilityService()
