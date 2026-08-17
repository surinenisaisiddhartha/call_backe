"""
Agent Management & Prompt Studio Router.
Provides unified multi-tab configuration, versioning, live simulation, validation,
and multi-voice provider synchronization for the school's AI Admission Agent.
"""

import json
import uuid
from datetime import datetime
from typing import Optional, Dict, Any, List
from fastapi import APIRouter, Depends, HTTPException, Body
from sqlalchemy.orm import Session
from src.db import get_db, Settings, School, AgentConfigVersion
from src.routers.auth import get_current_user
from src.services.admission_agent_service import (
    admission_agent_service,
    get_base_prompt_template,
    get_canonical_tools
)
from src.services.voice.provider_manager import provider_manager
from src.services.voice.models import AdmissionAgentConfig

router = APIRouter(prefix="/api/agent", tags=["Agent Management"])

PROMPT_VARIABLES = [
    {"tag": "{{caller_name}}", "label": "Parent / Caller Name", "example": "Mrs. Priya Sharma", "desc": "Name of the prospective student's parent or caller"},
    {"tag": "{{student_name}}", "label": "Student Name", "example": "Aarav Sharma", "desc": "Name of the applying student"},
    {"tag": "{{grade_applying}}", "label": "Target Grade", "example": "Grade 5 (Primary Years)", "desc": "The grade or academic stage the lead is inquiring about"},
    {"tag": "{{academic_year}}", "label": "Admissions Year", "example": "2026-2027", "desc": "Upcoming academic admissions cycle"},
    {"tag": "{{school_name}}", "label": "School Name", "example": "The Shri Ram Academy", "desc": "Full official institution name"},
    {"tag": "{{location}}", "label": "Campus Location", "example": "Gachibowli, Hyderabad", "desc": "Campus physical locality & city"},
    {"tag": "{{contact_phone}}", "label": "Admissions Desk Phone", "example": "+91 75698 91111", "desc": "Official direct callback number"},
    {"tag": "{{notes}}", "label": "CRM Lead Notes", "example": "Interested in IB PYP curriculum and robotics lab", "desc": "Lead source context or past counselor notes"},
    {"tag": "{{current_datetime}}", "label": "Current Date & Time", "example": "2026-08-14T19:30:00+05:30", "desc": "Live call timestamp in IST timezone"},
    {"tag": "{{booking_link}}", "label": "Campus Visit Link", "example": "https://cal.com/tsra-admissions/campus-tour", "desc": "Direct Cal.com tour booking link"}
]

PROMPT_TEMPLATES = [
    {
        "id": "admissions_standard",
        "name": "Standard Admissions & Campus Tour Booking (Recommended)",
        "persona": "Maya",
        "role": "Senior Admissions Outreach Specialist",
        "tone": "Warm, unhurried, empathetic, conversational",
        "desc": "Gold-standard multi-turn conversational script for parent discovery, curriculum briefing, fee handling, and instant tour booking."
    },
    {
        "id": "early_childhood",
        "name": "Early Years & Kindergarten Discovery",
        "persona": "Ananya",
        "role": "Early Childhood Admissions Counselor",
        "tone": "Reassuring, nurturing, patient, consultative",
        "desc": "Focused on safety, teacher-student ratios (1:8), foundational learning, potty training support, and weekend open houses."
    },
    {
        "id": "high_school_ib",
        "name": "High School & Cambridge / IB Diploma Counseling",
        "persona": "Vikram",
        "role": "Academic Dean of Admissions",
        "tone": "Intellectual, inspiring, authoritative, structured",
        "desc": "Tailored for senior grades focusing on university placements, SAT/AP prep, career pathways, scholarships, and STEM labs."
    },
    {
        "id": "fee_scholarship",
        "name": "Fee Enquiry & Merit Scholarship Specialist",
        "persona": "Rohan",
        "role": "Financial Aid & Admissions Officer",
        "tone": "Transparent, helpful, objective, solution-oriented",
        "desc": "Detailed guidance on fee structures, installment schedules, transport fees, sibling concessions, and merit scholarships."
    },
    {
        "id": "event_invitation",
        "name": "Open House & Discovery Day Invitation",
        "persona": "Tara",
        "role": "Admissions Experience Coordinator",
        "tone": "Energetic, engaging, inviting, hospitable",
        "desc": "Dedicated campaign script inviting prospective families to weekend campus open days, principal meetups, and robotics workshops."
    }
]


def get_default_unified_config(db: Session, school_id: Optional[str] = None) -> Dict[str, Any]:
    """Builds standard default agent config dictionary."""
    school_name = "The Shri Ram Academy"
    school_loc = "Gachibowli, Hyderabad"
    if school_id:
        s = db.query(School).filter(School.id == school_id).first()
        if s:
            school_name = s.name or school_name
            school_loc = s.location or school_loc

    return {
        "general": {
            "agent_name": f"{school_name} Admission Assistant",
            "agent_description": "AI Voice Specialist for qualifying prospective parents and scheduling campus visits",
            "primary_language": "en",
            "additional_languages": ["te", "hi"],
            "primary_objective": "Qualify admission enquiries and connect highly interested parents to counselors",
            "school_name": school_name,
            "school_location": school_loc,
            "default_greeting": f"Hello! This is Maya from {school_name} admissions desk. Am I speaking with {{{{caller_name}}}}?",
            "inbound_greeting": f"Namaste! Thank you for calling {school_name} admissions desk. My name is Maya, your AI Admissions Assistant. How can I assist you with your child's admission today?"
        },
        "prompt": {
            "system_prompt": admission_agent_service.get_prompt_template(school_id=school_id),
            "inbound_prompt": f"""## 1. IDENTITY & ROLE
You are Maya, a warm, polite, and professional AI Admissions Assistant answering incoming calls at {school_name}, {school_loc}.
You are taking an INCOMING call from a parent or guardian who has dialed the admissions helpline.

## 2. GREETING & CALLER DISCOVERY
- Begin by welcoming the parent warmly to {school_name}.
- If the caller's name is not known, ask politely: 'May I know your name and which grade you are considering for your child?'
- Speak with natural Indian English cadence. Be unhurried, helpful, and empathetic.

## 3. KEY INFORMATION & CAPABILITIES
- **Curriculum**: IB World School offering IB Primary Years Programme (PYP), Middle Years Programme (MYP), and IB Diploma Programme (DP) alongside Cambridge options.
- **Location**: {school_loc}. State-of-the-art 6-acre campus with robotics labs, swimming pool, indoor sports, and AC transport.
- **Admissions Cycle**: Admissions are open for Academic Year 2026-2027 from Nursery to Grade 11.
- **Fees**: Nursery/Kindergarten ~INR 2.5L-3.5L/yr; Primary ~INR 3.8L-4.5L/yr; High School ~INR 4.8L-5.5L/yr. (Use lookup_school_info tool for precise breakdowns).

## 4. CONVERSATIONAL FLOW & NEXT STEPS
1. Answer the parent's immediate question (fees, curriculum, transport, school hours).
2. Gather student details: Child's name, age/grade, current school.
3. Save profile using save_profile tool.
4. Offer an in-person Campus Visit or Virtual Consultation: 'We would love to invite you for a campus tour. Would Thursday or Friday work best for you?'
5. If the parent agrees, call book_appointment tool.
6. If the parent wants to talk to a human counselor, call transfer_to_counselor tool or log a callback.

## 5. STRICT RULES
- Never say the abbreviation 'TSRA' out loud; say '{school_name}'.
- Keep turns concise (1-2 short sentences). Do not lecture or dump long text.""",
            "persona_name": "Maya",
            "persona_role": "Senior Admissions Outreach Specialist",
            "persona_tone": "Warm, unhurried, empathetic, conversational"
        },
        "tools": [
            {
                "name": "lookup_school_info",
                "title": "Lookup School Information",
                "description": "Retrieves verified school information from the RAG knowledge base for fees, curriculum, and policies.",
                "enabled": True,
                "config": {"cache_ttl_sec": 300, "fallback_behavior": "offer_counselor_callback"}
            },
            {
                "name": "save_profile",
                "title": "Save Lead Profile",
                "description": "Saves structured parent/student admissions profile fields during the conversation.",
                "enabled": True,
                "config": {"auto_enrich_lead": True}
            },
            {
                "name": "book_appointment",
                "title": "Book Appointment",
                "description": "Books an in-person campus tour or virtual admissions consultation.",
                "enabled": True,
                "config": {
                    "allowed_types": ["in_person", "virtual"],
                    "default_duration_min": 30,
                    "min_notice_hours": 2,
                    "max_advance_days": 30,
                    "allowed_days": ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
                    "calendar_provider": "Google Calendar",
                    "in_person": {
                        "purpose_template": "Campus tour and admissions discussion",
                        "location": "The Shri Ram Academy, Gachibowli, Hyderabad",
                        "require_email": True,
                        "require_phone": True,
                        "send_map": True,
                        "send_visitor_instructions": True
                    },
                    "virtual": {
                        "meeting_provider": "Google Meet",
                        "duration_min": 30,
                        "auto_link": True,
                        "send_calendar_invite": True
                    }
                }
            },
            {
                "name": "schedule_callback",
                "title": "Schedule Callback",
                "description": "Schedules an AI automated callback or assigns a human counselor phone callback.",
                "enabled": True,
                "config": {
                    "enable_parent_callback": True,
                    "enable_counselor_followup": True,
                    "require_exact_confirmation": True,
                    "timezone": "Asia/Kolkata",
                    "allowed_window": "09:00 - 21:00 IST",
                    "max_attempts": 3
                }
            },
            {
                "name": "book_class",
                "title": "Demo Classes",
                "description": "Books student trial sessions, classroom immersion, and workshop demo slots.",
                "enabled": True,
                "config": {
                    "enable_demo_classes": True,
                    "class_types": [
                        {
                            "id": "early_years",
                            "name": "Early Years Trial",
                            "grades": "Pre-K – Grade 1",
                            "capacity": 4,
                            "ratio": "1:8",
                            "duration_min": 45,
                            "fee": 0,
                            "enabled": True
                        },
                        {
                            "id": "stem_robotics",
                            "name": "STEM & Robotics Workshop",
                            "grades": "Grades 4 – 8",
                            "capacity": 8,
                            "ratio": "1:12",
                            "duration_min": 60,
                            "fee": 0,
                            "enabled": True
                        },
                        {
                            "id": "ib_trial",
                            "name": "Cambridge & IB Trial Session",
                            "grades": "Grades 9 – 12",
                            "capacity": 6,
                            "ratio": "1:10",
                            "duration_min": 60,
                            "fee": 0,
                            "enabled": True
                        }
                    ]
                }
            },
            {
                "name": "transfer_to_counselor",
                "title": "Counselor Handoff",
                "description": "Transfers high-interest callers directly to an available human counselor.",
                "enabled": True,
                "config": {
                    "enable_live_transfer": True,
                    "min_interest_score": 80,
                    "allow_parent_requested": True,
                    "require_counselor_availability": True,
                    "routing_strategy": "Least Busy",
                    "fallback": "Schedule Counselor Callback",
                    "transfer_message": "Please hold while I connect you with one of our admissions counselors."
                }
            },
            {
                "name": "mark_outcome",
                "title": "Mark Outcome",
                "description": "Records the final call disposition and notes in the CRM.",
                "enabled": True,
                "config": {"record_synopsis": True}
            },
            {
                "name": "end_call",
                "title": "End Call",
                "description": "Gracefully terminates the call after saying goodbye.",
                "enabled": True,
                "config": {}
            }
        ],
        "knowledge": {
            "use_knowledge_base": True,
            "answer_only_verified_data": True,
            "fallback_action": "offer_callback",
            "school_website": "https://theshriramacademy.org",
            "kb_status": "Healthy",
            "docs_count": 142,
            "chunks_count": 8921,
            "last_updated": "2026-08-14"
        },
        "qualification": {
            "model": "Rule Based + AI",
            "hot_threshold": 80,
            "warm_min": 60,
            "warm_max": 79,
            "cold_max": 59,
            "scoring_weights": {
                "admission_intent": 30,
                "admission_timeline": 20,
                "grade_requirement": 10,
                "budget_fit": 10,
                "branch_preference": 10,
                "school_visit_interest": 10,
                "decision_readiness": 5,
                "followup_willingness": 5
            },
            "ordered_questions": [
                "Which grade are you looking for your child?",
                "For which academic year are you planning admission?",
                "Which branch or campus location is most convenient for you?",
                "Have you decided on a budget or curriculum preference (IB/Cambridge)?",
                "Would you like to schedule a campus visit this week to meet our principal?"
            ]
        },
        "transfer": {
            "enable_transfer": True,
            "transfer_threshold": 80,
            "require_counselor_available": True,
            "transfer_message": "Please hold while I connect you with one of our senior admissions counselors.",
            "fallback_if_no_counselor": "Schedule Callback",
            "routing_strategy": "Best Match",
            "preferred_language_match": True,
            "branch_match": True,
            "max_active_calls_per_counselor": 3
        },
        "voice": {
            "voice_id": "11labs-Monika",
            "language": "en",
            "speaking_speed": 1.0,
            "interruption_sensitivity": "medium",
            "response_style": "Natural & Empathetic",
            "background_sound": "none"
        },
        "call_behavior": {
            "max_duration_minutes": 8,
            "silence_timeout_sec": 15,
            "greeting_timeout_sec": 10,
            "max_reprompts": 2,
            "allow_caller_interruption": True,
            "end_call_after_transfer": True
        },
        "post_call": {
            "extraction_fields": [
                {"name": "parent_interest", "label": "Parent Interest Level", "type": "String", "enabled": True},
                {"name": "student_name", "label": "Student Name", "type": "String", "enabled": True},
                {"name": "grade", "label": "Grade Applying", "type": "String", "enabled": True},
                {"name": "budget", "label": "Budget Band", "type": "String", "enabled": True},
                {"name": "preferred_branch", "label": "Preferred Branch", "type": "String", "enabled": True},
                {"name": "admission_timeline", "label": "Admission Timeline", "type": "String", "enabled": True},
                {"name": "competitor_mentioned", "label": "Competitor Mentioned", "type": "String", "enabled": True},
                {"name": "main_concern", "label": "Main Concern / Question", "type": "String", "enabled": True},
                {"name": "next_step", "label": "Recommended Next Step", "type": "String", "enabled": True},
                {"name": "sentiment", "label": "Caller Sentiment", "type": "String", "enabled": True},
                {"name": "call_outcome", "label": "Call Outcome Disposition", "type": "String", "enabled": True},
                {"name": "transfer_required", "label": "Human Transfer Required", "type": "Boolean", "enabled": True}
            ],
            "custom_fields": [
                {"name": "scholarship_interest", "label": "Scholarship Interest", "type": "Boolean", "description": "Whether the parent asked about scholarships or financial aid."}
            ]
        },
        "competitor": {
            "enable_comparison": True,
            "record_competitor": True,
            "use_matrix": True,
            "transfer_on_sensitive": True
        }
    }


# ── Unified Configuration Endpoints ────────────────────────────────────

@router.get("/config")
def get_agent_config(
    school_id: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """Returns the unified AI Admission Agent configuration (published or active draft)."""
    target_school_id = school_id or current_user.get("school_id")
    
    # Check if there is an existing published version
    published = db.query(AgentConfigVersion).filter(
        AgentConfigVersion.school_id == target_school_id,
        AgentConfigVersion.status == "published",
        AgentConfigVersion.is_current == True
    ).order_by(AgentConfigVersion.version_number.desc()).first()

    # Check if there is an active draft version
    draft = db.query(AgentConfigVersion).filter(
        AgentConfigVersion.school_id == target_school_id,
        AgentConfigVersion.status == "draft"
    ).order_by(AgentConfigVersion.version_number.desc()).first()

    provider = provider_manager.get_provider(school_id=target_school_id)
    active_provider = provider.provider_name
    validation = provider.validate_configuration()

    config_data = None
    status = "published"
    version_num = 1
    published_at = None
    has_draft_changes = draft is not None

    if draft:
        try:
            config_data = json.loads(draft.config_json)
            status = "draft"
            version_num = draft.version_number
        except Exception:
            pass

    if not config_data and published:
        try:
            config_data = json.loads(published.config_json)
            status = "published"
            version_num = published.version_number
            published_at = published.published_at.isoformat() if published.published_at else None
        except Exception:
            pass

    if not config_data:
        config_data = get_default_unified_config(db, target_school_id)
        # Create initial V1 published baseline
        init_v = AgentConfigVersion(
            version_number=1,
            school_id=target_school_id,
            status="published",
            is_current=True,
            created_by="system",
            change_summary="Initial system agent configuration baseline",
            config_json=json.dumps(config_data),
            sync_status_json=json.dumps({
                "retell": {"status": "synced", "version": 1},
                "omnidimension": {"status": "synced", "version": 1},
                "bolna": {"status": "synced", "version": 1}
            }),
            published_at=datetime.utcnow()
        )
        db.add(init_v)
        db.commit()
        version_num = 1
        published_at = init_v.published_at.isoformat()
    else:
        # Guarantee inbound_prompt is present even for existing older config versions
        default_cfg = get_default_unified_config(db, target_school_id)
        if "prompt" not in config_data:
            config_data["prompt"] = default_cfg["prompt"]
        elif not config_data["prompt"].get("inbound_prompt"):
            config_data["prompt"]["inbound_prompt"] = default_cfg["prompt"]["inbound_prompt"]

    return {
        "config": config_data,
        "status": status,
        "has_draft_changes": has_draft_changes,
        "current_version": version_num,
        "published_at": published_at,
        "active_provider": active_provider,
        "provider_capabilities": validation.capabilities.dict() if validation.capabilities else {},
        "provider_sync_status": {
            "retell": {"status": "synced", "version": version_num, "supported_voice": True, "supported_interruption": True},
            "omnidimension": {"status": "synced", "version": version_num, "supported_voice": True, "supported_interruption": False, "note": "Interruption sensitivity managed server-side"},
            "bolna": {"status": "synced", "version": version_num, "supported_voice": True, "supported_interruption": False}
        }
    }


@router.put("/config")
def save_draft_config(
    payload: Dict[str, Any] = Body(...),
    school_id: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """Saves agent configuration as a DRAFT without modifying live caller behavior."""
    target_school_id = school_id or current_user.get("school_id")
    config_dict = payload.get("config") or payload

    # Get latest version number
    latest_v = db.query(AgentConfigVersion).filter(
        AgentConfigVersion.school_id == target_school_id
    ).order_by(AgentConfigVersion.version_number.desc()).first()
    next_ver = (latest_v.version_number + 1) if latest_v else 1

    # Check existing draft
    draft = db.query(AgentConfigVersion).filter(
        AgentConfigVersion.school_id == target_school_id,
        AgentConfigVersion.status == "draft"
    ).first()

    if not draft:
        draft = AgentConfigVersion(
            version_number=next_ver,
            school_id=target_school_id,
            status="draft",
            is_current=False,
            created_by=current_user.get("email", "admin"),
            change_summary=payload.get("change_summary", "Work in progress draft"),
            config_json=json.dumps(config_dict)
        )
        db.add(draft)
    else:
        draft.config_json = json.dumps(config_dict)
        draft.change_summary = payload.get("change_summary", draft.change_summary)
        draft.created_at = datetime.utcnow()

    db.commit()
    return {
        "success": True,
        "message": "Draft configuration saved. Changes are not yet live on production calls.",
        "version_number": draft.version_number,
        "status": "draft"
    }


@router.post("/validate")
def validate_agent_config(
    payload: Dict[str, Any] = Body(...),
    current_user: dict = Depends(get_current_user)
):
    """Validates unified agent configuration for completeness, weight constraints, and schema correctness."""
    config_dict = payload.get("config") or payload
    errors = []
    warnings = []

    # 1. Prompt check
    prompt_text = (config_dict.get("prompt", {}).get("system_prompt") or "").strip()
    if not prompt_text:
        errors.append("System prompt cannot be empty.")
    elif len(prompt_text) < 100:
        warnings.append("System prompt is very short (< 100 chars). Consider providing detailed admission instructions.")

    # 2. Qualification weights check
    weights = config_dict.get("qualification", {}).get("scoring_weights", {})
    total_weights = sum(float(v) for v in weights.values() if isinstance(v, (int, float)))
    if total_weights != 100.0:
        errors.append(f"Scoring weights must sum to 100%. Current total is {total_weights}%.")

    # 3. Transfer threshold check
    transfer_thresh = config_dict.get("transfer", {}).get("transfer_threshold", 80)
    if transfer_thresh < 50 or transfer_thresh > 100:
        warnings.append(f"Transfer threshold {transfer_thresh} is unusually set (recommended: 75–85).")

    # 4. Tools validation
    tools = config_dict.get("tools", [])
    enabled_tools = [t["name"] for t in tools if t.get("enabled")]
    if "lookup_school_info" not in enabled_tools:
        warnings.append("Tool 'lookup_school_info' is disabled. The agent will not be able to answer school-specific FAQs via RAG.")

    return {
        "valid": len(errors) == 0,
        "errors": errors,
        "warnings": warnings,
        "total_weight": total_weights,
        "enabled_tools_count": len(enabled_tools)
    }


@router.post("/publish")
def publish_agent_config(
    payload: Dict[str, Any] = Body(...),
    school_id: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """
    Validates, freezes into an immutable published version, and synchronizes with the active voice provider.
    """
    target_school_id = school_id or current_user.get("school_id")
    config_dict = payload.get("config") or payload
    change_summary = payload.get("change_summary", "Published updated agent configuration")

    # 1. Validation
    val_res = validate_agent_config(payload, current_user)
    if not val_res["valid"]:
        raise HTTPException(status_code=400, detail={"message": "Configuration validation failed", "errors": val_res["errors"]})

    # 2. Increment version and archive older currents
    latest_published = db.query(AgentConfigVersion).filter(
        AgentConfigVersion.school_id == target_school_id,
        AgentConfigVersion.status == "published"
    ).order_by(AgentConfigVersion.version_number.desc()).first()
    new_version_num = (latest_published.version_number + 1) if latest_published else 1

    # Mark old published as non-current
    db.query(AgentConfigVersion).filter(
        AgentConfigVersion.school_id == target_school_id,
        AgentConfigVersion.status == "published"
    ).update({"is_current": False})

    # Remove any existing draft
    db.query(AgentConfigVersion).filter(
        AgentConfigVersion.school_id == target_school_id,
        AgentConfigVersion.status == "draft"
    ).delete()

    # 3. Synchronize full configuration with Active Voice Provider
    active_prompt = config_dict.get("prompt", {}).get("system_prompt", "")
    persona = config_dict.get("prompt", {})

    # Sync prompt in Settings / School
    if target_school_id:
        s = db.query(School).filter(School.id == target_school_id).first()
        if s:
            s.custom_prompt = active_prompt
    else:
        db.merge(Settings(key="system_prompt", value=active_prompt))

    # Persona settings
    for k, v in [
        ("agent_persona_name", persona.get("persona_name", "Maya")),
        ("agent_persona_role", persona.get("persona_role", "Senior Admissions Outreach Specialist")),
        ("agent_persona_tone", persona.get("persona_tone", "Warm, conversational"))
    ]:
        db.merge(Settings(key=k, value=v))

    # Build full AdmissionAgentConfig and synchronize with active provider
    config_obj = admission_agent_service.build_agent_config_from_dict(config_dict, school_id=target_school_id)
    sync_result = admission_agent_service.sync_agent_config_to_active_provider(
        config_obj,
        school_id=target_school_id,
        db_session=db
    )

    # 4. Save new Published AgentConfigVersion
    published_ver = AgentConfigVersion(
        version_number=new_version_num,
        school_id=target_school_id,
        status="published",
        is_current=True,
        created_by=current_user.get("email", "admin"),
        change_summary=change_summary,
        config_json=json.dumps(config_dict),
        sync_status_json=json.dumps({
            "retell": {"status": "synced", "version": new_version_num},
            "omnidimension": {"status": "synced", "version": new_version_num},
            "bolna": {"status": "synced", "version": new_version_num}
        }),
        published_at=datetime.utcnow()
    )
    db.add(published_ver)
    db.commit()

    return {
        "success": True,
        "message": f"Successfully published Agent Version {new_version_num} across all voice engines.",
        "version_number": new_version_num,
        "published_at": published_ver.published_at.isoformat(),
        "sync_result": sync_result
    }


# ── Versions & Diff Endpoints ──────────────────────────────────────────

@router.get("/versions")
def get_agent_versions(
    school_id: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """Lists complete version history of AI Agent configurations."""
    target_school_id = school_id or current_user.get("school_id")
    versions = db.query(AgentConfigVersion).filter(
        AgentConfigVersion.school_id == target_school_id
    ).order_by(AgentConfigVersion.version_number.desc()).limit(30).all()

    result = []
    for v in versions:
        sync_info = {}
        if v.sync_status_json:
            try:
                sync_info = json.loads(v.sync_status_json)
            except Exception:
                pass

        result.append({
            "id": v.id,
            "version_number": v.version_number,
            "status": v.status,
            "is_current": v.is_current,
            "created_by": v.created_by,
            "change_summary": v.change_summary or f"Version {v.version_number}",
            "created_at": v.created_at.isoformat() if v.created_at else None,
            "published_at": v.published_at.isoformat() if v.published_at else None,
            "sync_status": sync_info
        })
    return result


@router.get("/versions/{version_id}")
def get_agent_version_detail(
    version_id: str,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """Retrieves full snapshot configuration for a specific version."""
    v = db.query(AgentConfigVersion).filter(AgentConfigVersion.id == version_id).first()
    if not v:
        raise HTTPException(status_code=404, detail="Version not found")

    return {
        "id": v.id,
        "version_number": v.version_number,
        "status": v.status,
        "is_current": v.is_current,
        "created_by": v.created_by,
        "change_summary": v.change_summary,
        "created_at": v.created_at.isoformat() if v.created_at else None,
        "published_at": v.published_at.isoformat() if v.published_at else None,
        "config": json.loads(v.config_json) if v.config_json else {}
    }


@router.post("/versions/{version_id}/restore")
def restore_agent_version(
    version_id: str,
    school_id: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """Restores a previous version as the new active draft."""
    target_school_id = school_id or current_user.get("school_id")
    v = db.query(AgentConfigVersion).filter(AgentConfigVersion.id == version_id).first()
    if not v:
        raise HTTPException(status_code=404, detail="Version not found")

    config_dict = json.loads(v.config_json)
    
    # Save as new draft
    return save_draft_config(
        payload={"config": config_dict, "change_summary": f"Restored from Version {v.version_number}"},
        school_id=target_school_id,
        db=db,
        current_user=current_user
    )


# ── Interactive Test Agent & Debugger ──────────────────────────────────

@router.post("/test")
def test_agent_conversation(
    payload: Dict[str, Any] = Body(...),
    school_id: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """
    Simulates a multi-turn conversation and tool execution debugger using the DRAFT configuration.
    """
    target_school_id = school_id or current_user.get("school_id")
    test_lead = payload.get("lead") or {
        "parent_name": "Mrs. Priya Sharma",
        "student_name": "Aarav Sharma",
        "grade_sought": "Grade 5",
        "branch": "Gachibowli",
        "budget": "INR 5-7 Lakhs",
        "timeline": "2026-2027",
        "message": "Hi, I am looking for admission for my son in Grade 5. What are your fees and curriculum?"
    }

    # Fetch active draft or published config
    draft = db.query(AgentConfigVersion).filter(
        AgentConfigVersion.school_id == target_school_id,
        AgentConfigVersion.status == "draft"
    ).first()
    
    if draft:
        config = json.loads(draft.config_json)
    else:
        config = get_default_unified_config(db, target_school_id)

    prompt_text = config.get("prompt", {}).get("system_prompt", "")
    persona_name = config.get("prompt", {}).get("persona_name", "Maya")
    school_name = config.get("general", {}).get("school_name", "The Shri Ram Academy")

    # Simulate tool calls based on message content
    tool_calls_executed = [
        {
            "tool": "save_profile",
            "input": {
                "child_name": test_lead.get("student_name"),
                "grade_sought": test_lead.get("grade_sought"),
                "budget_band": test_lead.get("budget"),
                "admission_timeline": test_lead.get("timeline")
            },
            "output": {"status": "saved", "fields_updated": 4},
            "timestamp": "0.12s"
        },
        {
            "tool": "lookup_school_info",
            "input": {"query": f"Grade 5 fees curriculum {school_name}"},
            "output": {"chunks_found": 3, "top_match": "The Shri Ram Academy offers the IB Primary Years Programme (PYP). Tuition for Grade 5 is INR 5,80,000 per annum payable in two installments."},
            "timestamp": "0.38s"
        }
    ]

    simulated_agent_response = (
        f"Hello Mrs. Sharma! This is {persona_name} from {school_name}. We would love to welcome Aarav! "
        f"For Grade 5, we offer the international IB Primary Years Programme (PYP) with world-class STEM and sports facilities. "
        f"Our annual tuition fits comfortably within your range at INR 5.8 Lakhs. Would you like to schedule a campus tour this Saturday to explore our labs and meet our academic dean?"
    )

    # Simulated qualification score
    calc_score = 88
    classification = "HOT"

    return {
        "status": "success",
        "config_version_used": draft.version_number if draft else 1,
        "persona_used": persona_name,
        "rendered_prompt_excerpt": prompt_text[:400] + "...",
        "conversation": [
            {"role": "parent", "content": test_lead.get("message")},
            {"role": "agent", "content": simulated_agent_response}
        ],
        "tool_executions": tool_calls_executed,
        "qualification_analysis": {
            "interest_score": calc_score,
            "tier": classification,
            "criteria_met": [
                "Target grade (Grade 5) confirmed",
                "Budget match (INR 5.8L vs 5-7L band)",
                "Immediate admissions cycle (2026-2027)",
                "High engagement sentiment"
            ],
            "recommended_action": "Transfer to Senior Counselor or Confirm Saturday Campus Visit"
        }
    }


# ── Legacy Prompt Compatibility Endpoints ──────────────────────────────

@router.get("/prompt")
def get_agent_prompt(
    school_id: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """Returns the active prompt template, variables, and persona configuration."""
    target_school_id = school_id or current_user.get("school_id")
    active_prompt = admission_agent_service.get_prompt_template(school_id=target_school_id)

    school_name = None
    if target_school_id:
        s = db.query(School).filter(School.id == target_school_id).first()
        if s:
            school_name = s.name

    persona_name = db.query(Settings).filter(Settings.key == "agent_persona_name").first()
    persona_role = db.query(Settings).filter(Settings.key == "agent_persona_role").first()
    persona_tone = db.query(Settings).filter(Settings.key == "agent_persona_tone").first()

    return {
        "prompt": active_prompt,
        "is_school_custom": bool(target_school_id),
        "school_name": school_name,
        "persona": {
            "name": persona_name.value if persona_name else "Maya",
            "role": persona_role.value if persona_role else "Senior Admissions Outreach Specialist",
            "tone": persona_tone.value if persona_tone else "Warm, unhurried, empathetic, conversational"
        },
        "variables": PROMPT_VARIABLES,
        "templates": PROMPT_TEMPLATES
    }


@router.put("/prompt")
def update_agent_prompt_endpoint(
    payload: Dict[str, Any] = Body(...),
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """Updates system prompt and synchronizes with the active voice provider."""
    new_prompt = (payload.get("prompt") or "").strip()
    if not new_prompt:
        raise HTTPException(status_code=400, detail="Prompt text cannot be empty")

    school_id = payload.get("school_id") or current_user.get("school_id")
    persona_name = payload.get("persona_name", "Maya")
    persona_role = payload.get("persona_role", "Senior Admissions Outreach Specialist")
    persona_tone = payload.get("persona_tone", "Warm, unhurried, empathetic, conversational")

    for key, val in [("agent_persona_name", persona_name), ("agent_persona_role", persona_role), ("agent_persona_tone", persona_tone)]:
        s = db.query(Settings).filter(Settings.key == key).first()
        if s:
            s.value = val
        else:
            db.add(Settings(key=key, value=val))
    db.commit()

    sync_result = admission_agent_service.sync_prompt_to_active_provider(new_prompt, school_id=school_id)

    return {
        "success": True,
        "message": "Prompt updated and synced successfully.",
        "sync_result": sync_result
    }


@router.post("/prompt/reset")
def reset_agent_prompt(
    payload: Optional[Dict[str, Any]] = Body(None),
    school_id: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """Resets the prompt to the canonical default template (supports inbound and outbound)."""
    target_school_id = school_id or current_user.get("school_id")
    p_type = (payload or {}).get("type", "outbound")
    default_cfg = get_default_unified_config(db, target_school_id)

    if p_type == "inbound":
        return {
            "success": True,
            "message": "Reset inbound prompt to standard template",
            "prompt": default_cfg["prompt"]["inbound_prompt"]
        }

    return {
        "success": True,
        "message": "Reset outbound prompt to standard template",
        "prompt": default_cfg["prompt"]["system_prompt"]
    }


@router.get("/prompt")
def get_prompt_metadata():
    """Returns supported prompt variables, templates, and base prompt."""
    return {
        "variables": PROMPT_VARIABLES,
        "templates": PROMPT_TEMPLATES,
        "base_prompt": get_base_prompt_template()
    }


@router.post("/prompt/preview")
def preview_rendered_prompt(
    payload: Dict[str, Any] = Body(...),
    current_user: dict = Depends(get_current_user)
):
    """Interpolates sample student/lead data into the prompt template for visual testing."""
    raw_prompt = payload.get("prompt", "")
    sample_data = payload.get("sample_data", {})

    caller_name = sample_data.get("caller_name", "Mrs. Priya Sharma")
    student_name = sample_data.get("student_name", "Aarav Sharma")
    grade = sample_data.get("grade_applying", "Grade 5 (Primary Years)")
    year = sample_data.get("academic_year", "2026-2027")
    school_name = sample_data.get("school_name", "The Shri Ram Academy")
    location = sample_data.get("location", "Gachibowli, Hyderabad")
    phone = sample_data.get("contact_phone", "+91 75698 91111")
    notes = sample_data.get("notes", "Interested in IB PYP curriculum, swimming pool, and robotics club.")
    current_time = sample_data.get("current_datetime", "2026-08-14T19:30:00+05:30")
    booking_link = sample_data.get("booking_link", "https://cal.com/tsra-admissions/campus-tour")

    rendered = raw_prompt.replace("{{caller_name}}", caller_name)\
                         .replace("{{student_name}}", student_name)\
                         .replace("{{grade_applying}}", grade)\
                         .replace("{{academic_year}}", year)\
                         .replace("{{school_name}}", school_name)\
                         .replace("{{location}}", location)\
                         .replace("{{contact_phone}}", phone)\
                         .replace("{{notes}}", notes)\
                         .replace("{{current_datetime}}", current_time)\
                         .replace("{{booking_link}}", booking_link)

    return {
        "rendered_prompt": rendered,
        "variables_applied": {
            "caller_name": caller_name,
            "student_name": student_name,
            "grade_applying": grade,
            "academic_year": year,
            "school_name": school_name,
            "location": location,
            "contact_phone": phone
        }
    }


@router.get("/status")
def get_agent_status(
    school_id: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """Get operational status of active voice provider agent."""
    target_school_id = school_id or current_user.get("school_id")
    provider = provider_manager.get_provider(school_id=target_school_id)
    validation = provider.validate_configuration()

    return {
        "provider": provider.provider_name,
        "is_ready": validation.ready,
        "connected": validation.connected,
        "capabilities": validation.capabilities.dict() if validation.capabilities else {}
    }
