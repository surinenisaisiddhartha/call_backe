"""
Counselor Routing & Call Transfer Service.
Resolves available counselors and coordinates live SIP/PSTN call transfers across voice providers.
"""

from typing import Optional, Dict, Any
from sqlalchemy.orm import Session
from src.db import SessionLocal, Counselor, Contact, CounselorActivity, CallAttempt
from src.services.voice.provider_manager import provider_manager
from src.services.voice.models import TRANSFER_REQUESTED, TRANSFER_STARTED, TRANSFER_CONNECTED, TRANSFER_FAILED
from src.events import event_manager


class CounselorRouter:
    @staticmethod
    def get_available_counselor(school_id: Optional[str] = None, db: Optional[Session] = None) -> Optional[Counselor]:
        """
        Finds the best available counselor:
        1. availability_status == 'Available'
        2. Filtered by school_id (or global)
        3. Ordered by least active leads assigned (least loaded)
        """
        should_close = False
        if db is None:
            db = SessionLocal()
            should_close = True

        try:
            query = db.query(Counselor).filter(
                Counselor.availability_status == "Available"
            )
            if school_id:
                query = query.filter(Counselor.school_id == school_id)

            counselors = query.all()
            if not counselors:
                # Fallback: check any counselor with phone number
                fallback_query = db.query(Counselor).filter(Counselor.phone_number.isnot(None))
                if school_id:
                    fallback_query = fallback_query.filter(Counselor.school_id == school_id)
                return fallback_query.first()

            # Pick counselor with fewest assigned contacts
            best_counselor = None
            min_count = float("inf")
            for c in counselors:
                assigned_count = db.query(Contact).filter(Contact.assigned_counselor_id == c.id).count()
                if assigned_count < (c.max_capacity or 50) and assigned_count < min_count:
                    min_count = assigned_count
                    best_counselor = c

            return best_counselor or counselors[0]
        finally:
            if should_close:
                db.close()

    @staticmethod
    def execute_transfer(
        provider: str,
        provider_call_id: str,
        contact_id: Optional[str] = None,
        school_id: Optional[str] = None,
        reason: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Coordinates counselor lookup and triggers transfer via the provider adapter.
        """
        db = SessionLocal()
        try:
            # 1. Resolve contact if not provided
            contact = None
            if contact_id:
                contact = db.query(Contact).filter(Contact.id == contact_id).first()
            elif provider_call_id:
                attempt = db.query(CallAttempt).filter(
                    CallAttempt.provider_call_id == provider_call_id
                ).first()
                if attempt:
                    contact = attempt.contact

            target_school_id = school_id or (contact.school_id if contact else None)

            # 2. Select counselor
            counselor = CounselorRouter.get_available_counselor(school_id=target_school_id, db=db)
            if not counselor or not counselor.phone_number:
                return {
                    "success": False,
                    "message": "No available counselor found with a valid phone number for live transfer.",
                    "transfer_number": None
                }

            # 3. Assign contact to counselor if available
            if contact:
                contact.assigned_counselor_id = counselor.id
                contact.counselor_followup_status = "InProgress"

                # Record activity
                activity = CounselorActivity(
                    contact_id=contact.id,
                    counselor_id=counselor.id,
                    action_type="CallTransfer",
                    outcome="Transfer Requested",
                    notes=f"Live AI call transfer initiated to {counselor.name} ({counselor.phone_number}). Reason: {reason or 'Admission consultation requested'}"
                )
                db.add(activity)
                db.commit()

            # 4. Trigger transfer via active provider
            adapter = provider_manager.get_adapter_by_name(provider, school_id=target_school_id)
            transfer_ok = adapter.transfer_call(provider_call_id, counselor.phone_number)

            return {
                "success": transfer_ok,
                "transfer_number": counselor.phone_number,
                "counselor_name": counselor.name,
                "counselor_id": counselor.id,
                "message": f"Transferring to {counselor.name} at {counselor.phone_number}."
            }
        except Exception as e:
            print(f"[COUNSELOR ROUTER] execute_transfer failed: {e}")
            return {
                "success": False,
                "error": str(e),
                "transfer_number": None
            }
        finally:
            db.close()


counselor_router = CounselorRouter()
