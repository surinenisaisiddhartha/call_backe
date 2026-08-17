"""
Common Voice Provider Data Models.
Standardized schemas for requests, results, events, and provider validation.
"""

import uuid
from typing import Dict, Any, Optional, List
from datetime import datetime
from pydantic import BaseModel, Field
from src.services.voice.capabilities import ProviderCapabilities

# Common Call & Admission Lifecycle Event Types
CALL_STARTED = "CALL_STARTED"
CALL_CONNECTED = "CALL_CONNECTED"
CALL_UPDATED = "CALL_UPDATED"
CALL_ENDED = "CALL_ENDED"
CALL_ANALYZED = "CALL_ANALYZED"

TRANSFER_REQUESTED = "TRANSFER_REQUESTED"
TRANSFER_STARTED = "TRANSFER_STARTED"
TRANSFER_CONNECTED = "TRANSFER_CONNECTED"
TRANSFER_FAILED = "TRANSFER_FAILED"

LEAD_PROFILE_UPDATED = "LEAD_PROFILE_UPDATED"
LEAD_SCORED = "LEAD_SCORED"
CALL_QUALIFIED = "CALL_QUALIFIED"
CALL_DISQUALIFIED = "CALL_DISQUALIFIED"

APPOINTMENT_BOOKED = "APPOINTMENT_BOOKED"
CALLBACK_SCHEDULED = "CALLBACK_SCHEDULED"


class OutboundCallRequest(BaseModel):
    to_number: str
    from_number: Optional[str] = None
    from_number_id: Optional[str] = None
    agent_id: str
    contact_id: Optional[str] = None
    school_id: Optional[str] = None
    campaign_id: Optional[str] = None
    context: Dict[str, Any] = Field(default_factory=dict)
    metadata: Dict[str, Any] = Field(default_factory=dict)


class CommonCallResult(BaseModel):
    provider_call_id: str
    provider: str
    status: str = "initiated"
    started_at: datetime = Field(default_factory=datetime.utcnow)
    raw_response: Dict[str, Any] = Field(default_factory=dict)


class CommonCallDetails(BaseModel):
    provider_call_id: str
    provider: str
    status: str
    duration_seconds: float = 0.0
    transcript: Optional[str] = None
    summary: Optional[str] = None
    recording_url: Optional[str] = None
    sentiment: Optional[str] = None
    extracted_variables: Dict[str, Any] = Field(default_factory=dict)
    cost_breakdown: Optional[Dict[str, Any]] = None


class CommonCallEvent(BaseModel):
    event_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    event_type: str
    provider: str
    provider_call_id: str
    internal_call_id: Optional[str] = None
    contact_id: Optional[str] = None
    campaign_id: Optional[str] = None
    school_id: Optional[str] = None
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    provider_status: Optional[str] = None
    normalized_data: Dict[str, Any] = Field(default_factory=dict)


class ProviderValidationResult(BaseModel):
    provider: str
    connected: bool = False
    agent_configured: bool = False
    phone_configured: bool = False
    webhook_configured: bool = False
    ready: bool = False
    missing_fields: List[str] = Field(default_factory=list)
    error_message: Optional[str] = None
    capabilities: Optional[ProviderCapabilities] = None


class AdmissionAgentConfig(BaseModel):
    agent_name: str
    system_prompt: str
    voice_id: Optional[str] = None
    voice_speed: Optional[float] = 1.0
    voice_pitch: Optional[float] = 0.0
    voice_temperature: Optional[float] = 0.3
    ambient_sound: Optional[str] = None
    ambient_sound_volume: Optional[float] = 0.5
    responsiveness: Optional[float] = 1.0
    interruption_sensitivity: Optional[float] = 0.8
    enable_backchannel: Optional[bool] = True
    backchannel_frequency: Optional[float] = 0.8
    end_call_after_silence_ms: Optional[int] = 30000
    max_call_duration_ms: Optional[int] = 600000
    reminder_trigger_ms: Optional[int] = 10000
    begin_message: Optional[str] = None
    voicemail_detection: Optional[bool] = True
    voicemail_message: Optional[str] = None
    temperature: float = 0.3
    language: str = "en-IN"
    tools: List[Dict[str, Any]] = Field(default_factory=list)
    transfer_number: Optional[str] = None
    transfer_prompt: Optional[str] = None
    transfer_policy: Optional[Dict[str, Any]] = None
    webhook_url: Optional[str] = None
    post_call_analysis_data: Optional[List[Dict[str, Any]]] = None
    model: Optional[str] = "gpt-4o"
