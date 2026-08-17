"""
Admission Agent Service.
Decoupled management for system prompts, agent templates, tools, and multi-provider provisioning.
"""

import os
from pathlib import Path
from typing import Optional, Dict, Any, List
from sqlalchemy.orm import Session
from src.db import SessionLocal, School, Settings, VoiceProviderConfig
from src.services.voice.provider_manager import provider_manager
from src.services.voice.models import AdmissionAgentConfig


PROMPT_FILE = Path(__file__).parent.parent.parent / "agent_prompt.md"

_TEMPLATE_SCHOOL_NAME_FULL = "The Shri Ram Academy"
_TEMPLATE_SCHOOL_NAME = "Shri Ram Academy"
_TEMPLATE_LOCATION_FULL = "Gachibowli, Hyderabad"
_TEMPLATE_LOCALITY = "Gachibowli"
_TEMPLATE_PHONE = "+91 7569891111"
_TEMPLATE_ABBREVIATION = "TSRA"


def get_base_prompt_template() -> str:
    """Reads base canonical prompt template from agent_prompt.md or fallback."""
    if PROMPT_FILE.exists():
        try:
            return PROMPT_FILE.read_text(encoding="utf-8")
        except Exception:
            pass
    return "You are an admissions advisor assisting parents with school inquiries."


def render_prompt_for_school(template: str, school: School) -> str:
    """Substitutes school-specific information into the prompt template."""
    if not school:
        return template

    school_name = school.name or _TEMPLATE_SCHOOL_NAME_FULL
    short_name = school_name.replace("The ", "")
    location = school.location or _TEMPLATE_LOCATION_FULL
    locality = location.split(",")[0].strip() if "," in location else location
    contact_phone = school.contact_phone or _TEMPLATE_PHONE
    abbr = "".join([w[0] for w in short_name.split() if w[0].isupper()]) or _TEMPLATE_ABBREVIATION

    rendered = template
    rendered = rendered.replace(_TEMPLATE_SCHOOL_NAME_FULL, school_name)
    rendered = rendered.replace(_TEMPLATE_SCHOOL_NAME, short_name)
    rendered = rendered.replace(_TEMPLATE_LOCATION_FULL, location)
    rendered = rendered.replace(_TEMPLATE_LOCALITY, locality)
    rendered = rendered.replace(_TEMPLATE_PHONE, contact_phone)
    rendered = rendered.replace(_TEMPLATE_ABBREVIATION, abbr)
    return rendered


def get_canonical_tools(
    webhook_base_url: Optional[str] = None,
    enabled_tool_names: Optional[List[str]] = None,
    transfer_number: Optional[str] = None,
    tool_configs: Optional[Dict[str, Any]] = None
) -> List[Dict[str, Any]]:
    """Returns standard tool definitions for admission calls, filtered by enabled status."""
    base = (webhook_base_url or os.getenv("WEBHOOK_BASE_URL", "http://localhost:5000")).rstrip("/")
    if base.endswith("/api/webhooks"):
        base = base[:-len("/api/webhooks")]
    elif base.endswith("/api"):
        base = base[:-len("/api")]

    tools_secret = os.getenv("ADMISSION_TOOLS_SECRET") or os.getenv("AEGIS_TOOLS_SECRET", "")
    headers = {"X-Admission-Tools-Secret": tools_secret} if tools_secret else {}

    transfer_desc = (
        f"Transfers the live call to an available admissions counselor at {transfer_number} when the lead is highly interested or requests human assistance."
        if transfer_number else
        "Transfers the live call to an available admissions counselor when the lead is highly interested or requests human assistance."
    )

    all_tools = [
        {
            "name": "lookup_school_info",
            "description": "Searches the school knowledge base for answers to questions about fees, curriculum, admissions, policies, or facilities.",
            "url": f"{base}/api/webhooks/tools/lookup",
            "headers": headers,
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "The search query."}
                },
                "required": ["query"]
            }
        },
        {
            "name": "save_profile",
            "description": "Saves details learned about the student or family (child name, grade sought, budget, board preference).",
            "url": f"{base}/api/webhooks/tools/save-profile",
            "headers": headers,
            "parameters": {
                "type": "object",
                "properties": {
                    "child_name": {"type": "string"},
                    "grade_sought": {"type": "string"},
                    "board_preference": {"type": "string"},
                    "budget_band": {"type": "string"}
                }
            }
        },
        {
            "name": "book_appointment",
            "description": "Books an in-person campus tour or virtual admissions consultation for the parent.",
            "url": f"{base}/api/webhooks/tools/book-appointment",
            "headers": headers,
            "parameters": {
                "type": "object",
                "properties": {
                    "datetime_iso": {"type": "string", "description": "ISO 8601 timestamp in IST."},
                    "purpose": {"type": "string", "description": "Campus visit or video consultation."},
                    "meeting_type": {"type": "string", "enum": ["in_person", "virtual"], "description": "In-person campus visit vs. virtual video meeting."}
                },
                "required": ["datetime_iso", "meeting_type"]
            }
        },
        {
            "name": "schedule_callback",
            "description": "Schedules an AI automated callback or assigns a human counselor phone callback at a requested time.",
            "url": f"{base}/api/webhooks/tools/schedule-callback",
            "headers": headers,
            "parameters": {
                "type": "object",
                "properties": {
                    "datetime_iso": {"type": "string", "description": "ISO 8601 timestamp in IST."},
                    "reason": {"type": "string", "description": "Reason for the callback."},
                    "followup_type": {"type": "string", "enum": ["ai_callback", "counselor_callback", "counselor_task"], "description": "Type of follow-up required."}
                },
                "required": ["datetime_iso"]
            }
        },
        {
            "name": "book_class",
            "description": "Books a student demo class, trial session, or workshop (Early Years Trial, STEM Robotics, IB Demo).",
            "url": f"{base}/api/webhooks/tools/book-class",
            "headers": headers,
            "parameters": {
                "type": "object",
                "properties": {
                    "student_name": {"type": "string", "description": "Student's full name."},
                    "grade_sought": {"type": "string", "description": "Grade level applying for."},
                    "class_type": {"type": "string", "description": "Demo class name (Early Years Trial, STEM Robotics Workshop, IB Trial)."},
                    "datetime_iso": {"type": "string", "description": "Scheduled date and time in ISO 8601 format."}
                },
                "required": ["student_name", "class_type", "datetime_iso"]
            }
        },
        {
            "name": "transfer_to_counselor",
            "description": transfer_desc,
            "url": f"{base}/api/webhooks/tools/transfer-counselor",
            "headers": headers,
            "parameters": {
                "type": "object",
                "properties": {
                    "reason": {"type": "string", "description": "Reason for transferring to a human counselor."}
                }
            }
        },
        {
            "name": "mark_outcome",
            "description": "Records the final disposition or outcome of the conversation.",
            "url": f"{base}/api/webhooks/tools/mark-outcome",
            "headers": headers,
            "parameters": {
                "type": "object",
                "properties": {
                    "outcome": {"type": "string", "enum": ["Interested", "NotInterested", "Voicemail", "WrongNumber", "FollowUpRequested"]},
                    "notes": {"type": "string"}
                },
                "required": ["outcome"]
            }
        },
        {
            "name": "end_call",
            "description": "Gracefully terminates the phone call after concluding the conversation.",
            "url": f"{base}/api/webhooks/tools/end-call",
            "headers": headers,
            "parameters": {"type": "object", "properties": {}}
        }
    ]

    if enabled_tool_names is not None:
        enabled_set = set(enabled_tool_names)
        return [t for t in all_tools if t["name"] in enabled_set]

    return all_tools


def _safe_float(val: Any, default: float = 0.0) -> float:
    if val is None or val == "":
        return default
    if isinstance(val, (int, float)):
        return float(val)
    val_str = str(val).strip().lower()
    mapping = {
        "low": 0.3,
        "medium": 0.7,
        "high": 0.9,
        "fast": 1.2,
        "slow": 0.8,
        "normal": 1.0,
    }
    if val_str in mapping:
        return mapping[val_str]
    try:
        return float(val_str)
    except (ValueError, TypeError):
        return default


def _safe_int(val: Any, default: int = 0) -> int:
    if val is None or val == "":
        return default
    if isinstance(val, int):
        return val
    try:
        return int(float(str(val).strip()))
    except (ValueError, TypeError):
        return default


class AdmissionAgentService:
    """Core domain service for managing the admission voice agent across providers."""

    @staticmethod
    def get_agent_config_for_school(school_id: Optional[str] = None) -> Dict[str, Any]:
        """Retrieves unified agent configuration with school overrides."""
        db = SessionLocal()
        try:
            school = db.query(School).filter(School.id == school_id).first() if school_id else None
            settings_records = db.query(Settings).all()
            settings_map = {s.key: s.value for s in settings_records}

            # Retrieve active provider
            active_provider = settings_map.get("active_voice_provider", "retell")

            # Base configuration
            base_prompt = AdmissionAgentService.get_effective_prompt_for_school(school_id)

            # Build unified configuration payload
            config = {
                "general": {
                    "agent_name": school.name + " Admissions Assistant" if school else "Admission Voice Assistant",
                    "primary_language": "en-IN",
                    "default_greeting": f"Hello, thank you for calling {school.name if school else 'our admissions office'}. How may I help you today?",
                    "school_id": school.id if school else None,
                    "school_name": school.name if school else "The Shri Ram Academy",
                    "active_provider": active_provider
                },
                "prompt": {
                    "system_prompt": base_prompt,
                    "version": 1,
                    "auto_generate": False
                },
                "voice": {
                    "provider": active_provider,
                    "voice_id": settings_map.get(f"{active_provider}_default_voice", "11labs-Adrian"),
                    "speed": 1.0,
                    "pitch": 0.0,
                    "temperature": 0.3,
                    "ambient_sound": "coffee-shop",
                    "ambient_sound_volume": 0.2,
                    "responsiveness": 1.0,
                    "interruption_sensitivity": 0.8,
                    "enable_backchannel": True,
                    "backchannel_frequency": 0.8
                },
                "call_behavior": {
                    "end_call_after_silence_ms": 30000,
                    "max_call_duration_ms": 600000,
                    "reminder_trigger_ms": 10000,
                    "voicemail_detection": True,
                    "voicemail_message": "Hello, we tried reaching you regarding school admissions. We will call back shortly."
                },
                "scoring": {
                    "weights": {
                        "intent_clarity": 20,
                        "timeline_urgency": 20,
                        "budget_fit": 20,
                        "decision_maker": 20,
                        "engagement_depth": 20
                    },
                    "thresholds": {
                        "hot_min": 75,
                        "warm_min": 50
                    }
                },
                "transfer": {
                    "transfer_number": school.contact_phone if school else "+91 7569891111",
                    "counselor_phone": school.contact_phone if school else "+91 7569891111",
                    "warm_transfer_prompt": "Please hold while I connect you directly with our senior admissions counselor.",
                    "enable_human_fallback": True
                },
                "tools": [
                    {"name": "knowledge_lookup", "enabled": True, "description": "Lookup school curriculum, fees, and admissions info"},
                    {"name": "schedule_callback", "enabled": True, "description": "Schedule a telephone callback with counselor"},
                    {"name": "book_appointment", "enabled": True, "description": "Book an in-person school campus visit"},
                    {"name": "transfer_counselor", "enabled": True, "description": "Transfer caller to human admissions counselor"},
                    {"name": "mark_outcome", "enabled": True, "description": "Save lead qualification status and outcome"},
                    {"name": "save_lead_profile", "enabled": True, "description": "Save prospective student profile details"}
                ]
            }

            return config
        finally:
            db.close()

    @staticmethod
    def get_effective_prompt_for_school(school_id: Optional[str] = None) -> str:
        """Renders prompt with school variables."""
        db = SessionLocal()
        try:
            school = db.query(School).filter(School.id == school_id).first() if school_id else None
            template = get_base_prompt_template()
            if school:
                return render_prompt_for_school(template, school)
            return get_base_prompt_template()
        finally:
            db.close()

    @staticmethod
    def get_prompt_template(school_id: Optional[str] = None) -> str:
        """Returns the active prompt template (per-school override or global)."""
        db = SessionLocal()
        try:
            if school_id:
                school = db.query(School).filter(School.id == school_id).first()
                if school and school.custom_prompt:
                    return school.custom_prompt

            setting = db.query(Settings).filter(Settings.key == "system_prompt").first()
            if setting and setting.value:
                return setting.value
            return get_base_prompt_template()
        finally:
            db.close()

    @staticmethod
    def build_agent_config_from_dict(config_dict: Dict[str, Any], school_id: Optional[str] = None) -> AdmissionAgentConfig:
        """Builds a comprehensive AdmissionAgentConfig from the unified AgentConfig dict."""
        general = config_dict.get("general", {})
        prompt = config_dict.get("prompt", {})
        voice = config_dict.get("voice", {})
        call_behavior = config_dict.get("call_behavior", {})
        transfer = config_dict.get("transfer", {})
        tools_list = config_dict.get("tools", [])

        # Filter enabled tools
        enabled_names = []
        for t in tools_list:
            if isinstance(t, dict) and t.get("enabled", True):
                enabled_names.append(t.get("name"))

        transfer_phone = transfer.get("transfer_number") or transfer.get("counselor_phone")
        canonical_tools = get_canonical_tools(
            enabled_tool_names=enabled_names if enabled_names else None,
            transfer_number=transfer_phone
        )

        return AdmissionAgentConfig(
            agent_name=general.get("agent_name", "Admission Voice Agent"),
            system_prompt=prompt.get("system_prompt", ""),
            voice_id=voice.get("voice_id"),
            voice_speed=_safe_float(voice.get("speed") or voice.get("voice_speed"), 1.0),
            voice_pitch=_safe_float(voice.get("pitch") or voice.get("voice_pitch"), 0.0),
            voice_temperature=_safe_float(voice.get("temperature") or voice.get("voice_temperature"), 0.3),
            ambient_sound=voice.get("ambient_sound"),
            ambient_sound_volume=_safe_float(voice.get("ambient_sound_volume"), 0.5),
            responsiveness=_safe_float(voice.get("responsiveness") or voice.get("responsivity"), 1.0),
            interruption_sensitivity=_safe_float(voice.get("interruption_sensitivity"), 0.8),
            enable_backchannel=voice.get("enable_backchannel") if voice.get("enable_backchannel") is not None else voice.get("backchannel", True),
            backchannel_frequency=_safe_float(voice.get("backchannel_frequency"), 0.8),
            end_call_after_silence_ms=_safe_int(call_behavior.get("end_call_after_silence_ms"), 30000),
            max_call_duration_ms=_safe_int(call_behavior.get("max_call_duration_ms"), 600000),
            reminder_trigger_ms=_safe_int(call_behavior.get("reminder_trigger_ms"), 10000),
            begin_message=general.get("default_greeting") or general.get("begin_message"),
            voicemail_detection=bool(call_behavior.get("voicemail_detection", True)),
            voicemail_message=call_behavior.get("voicemail_message"),
            temperature=_safe_float(voice.get("temperature"), 0.3),
            language=general.get("primary_language") or general.get("language") or "en-IN",
            tools=canonical_tools,
            transfer_number=transfer_phone,
            transfer_prompt=transfer.get("warm_transfer_prompt")
        )

    @staticmethod
    def sync_agent_config_to_active_provider(
        config_obj: AdmissionAgentConfig,
        school_id: Optional[str] = None,
        db_session: Optional[Any] = None
    ) -> Dict[str, Any]:
        """Synchronizes full agent configuration (prompt, voice, behavior, tools) to the active provider."""
        db = db_session if db_session is not None else SessionLocal()
        should_close = db_session is None
        try:
            # 1. Update in DB settings / school record
            if school_id:
                school = db.query(School).filter(School.id == school_id).first()
                if school:
                    school.custom_prompt = config_obj.system_prompt
            else:
                db.merge(Settings(key="system_prompt", value=config_obj.system_prompt))
            
            if should_close:
                db.commit()

            # 2. Sync to active provider
            provider = provider_manager.get_provider(school_id=school_id)
            target_agent_id = None
            if school_id:
                cfg = db.query(VoiceProviderConfig).filter(
                    VoiceProviderConfig.school_id == school_id,
                    VoiceProviderConfig.provider == provider.provider_name
                ).first()
                if cfg:
                    target_agent_id = cfg.agent_id
            else:
                cfg = db.query(VoiceProviderConfig).filter(
                    VoiceProviderConfig.school_id == None,
                    VoiceProviderConfig.provider == provider.provider_name
                ).first()
                if cfg:
                    target_agent_id = cfg.agent_id

            if target_agent_id:
                return provider.update_agent(target_agent_id, config_obj)

            return {"success": True, "message": "Configuration saved locally in DB."}
        finally:
            if should_close:
                db.close()

    @staticmethod
    def sync_prompt_to_active_provider(prompt: str, school_id: Optional[str] = None) -> Dict[str, Any]:
        """Backward-compatible prompt-only sync helper."""
        cfg = AdmissionAgentConfig(
            agent_name="EnquiryCall Admission Agent",
            system_prompt=prompt,
            tools=get_canonical_tools()
        )
        return AdmissionAgentService.sync_agent_config_to_active_provider(cfg, school_id=school_id)

    @staticmethod
    def provision_school_agent(school_id: str, provider_name: Optional[str] = None) -> Dict[str, Any]:
        """Provisions an admission agent for the school using the specified or active provider."""
        db = SessionLocal()
        try:
            school = db.query(School).filter(School.id == school_id).first()
            if not school:
                raise ValueError(f"School {school_id} not found")

            # Determine provider
            adapter = (
                provider_manager.get_adapter_by_name(provider_name, school_id=school_id)
                if provider_name else provider_manager.get_provider(school_id=school_id)
            )

            # Build config
            raw_template = school.custom_prompt or get_base_prompt_template()
            rendered_prompt = render_prompt_for_school(raw_template, school)
            tools = get_canonical_tools()

            agent_config = AdmissionAgentConfig(
                agent_name=f"{school.name} Admission Agent",
                system_prompt=rendered_prompt,
                tools=tools
            )

            # Call provider to create agent
            res = adapter.create_agent(agent_config)
            agent_id = res.get("agent_id")

            # Persist provider config
            cfg = db.query(VoiceProviderConfig).filter(
                VoiceProviderConfig.school_id == school.id,
                VoiceProviderConfig.provider == adapter.provider_name
            ).first()
            if not cfg:
                cfg = VoiceProviderConfig(
                    school_id=school.id,
                    provider=adapter.provider_name,
                    agent_id=agent_id,
                    is_active=True,
                    configuration_status="ready"
                )
                db.add(cfg)
            else:
                cfg.agent_id = agent_id
                cfg.configuration_status = "ready"

            # Backward-compatibility: if Retell, also save on School model
            if adapter.provider_name == "retell":
                school.retell_agent_id = agent_id
                school.retell_llm_id = res.get("llm_id")

            db.commit()
            print(f"[ADMISSION AGENT] Provisioned agent {agent_id} on {adapter.provider_name} for school {school.name}")
            return {
                "success": True,
                "provider": adapter.provider_name,
                "agent_id": agent_id,
                "school_id": school.id
            }
        finally:
            db.close()


admission_agent_service = AdmissionAgentService()

