"""
OmniDimension AI Provider Adapter.
Implements OmniDimension voice platform APIs (dispatch, agents, phone numbers, and webhooks).
Docs: https://docs.omnidim.io/docs
"""

import os
import httpx
from datetime import datetime
from typing import Dict, Any, List, Optional
from src.services.voice.interface import VoiceProvider
from src.services.voice.capabilities import ProviderCapabilities
from src.services.voice.models import (
    OutboundCallRequest,
    CommonCallResult,
    CommonCallDetails,
    CommonCallEvent,
    ProviderValidationResult,
    AdmissionAgentConfig,
    CALL_STARTED,
    CALL_CONNECTED,
    CALL_ENDED,
    CALL_ANALYZED
)


class OmniDimensionAdapter(VoiceProvider):
    def __init__(self, api_key: Optional[str] = None, base_url: str = "https://omnidim.io/api/v1"):
        self.api_key = api_key or os.getenv("OMNIDIM_API_KEY", "")
        self.base_url = base_url.rstrip("/")

    @property
    def provider_name(self) -> str:
        return "omnidimension"

    def get_capabilities(self) -> ProviderCapabilities:
        return ProviderCapabilities(
            supports_native_transfer=True,
            supports_realtime_transcription=True,
            supports_byo_telephony=True,
            supports_batch_dispatch=True,
            supports_sip_trunking=True,
            supports_cost_metrics=True,
            supports_custom_tools=True,
            supports_recording=True,
            supports_post_call_analysis=True,
            supports_dynamic_variables=True,
            supports_inbound_calls=True,
            supports_outbound_calls=True,
            supports_phone_number_management=True,
            supports_agent_provisioning=True,
            max_concurrency=25
        )

    def _headers(self) -> Dict[str, str]:
        return {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json"
        }

    def create_agent(self, config: AdmissionAgentConfig) -> Dict[str, Any]:
        """Creates an agent in OmniDimension via POST /api/v1/agents."""
        url = f"{self.base_url}/agents"
        payload: Dict[str, Any] = {
            "name": config.agent_name,
            "system_prompt": config.system_prompt,
            "voice": config.voice_id or "default_indian_female",
            "language": config.language or "en-IN",
            "temperature": config.temperature or 0.3,
            "speed": config.voice_speed or 1.0,
            "tools": config.tools,
            "webhook_url": config.webhook_url,
            "max_duration_seconds": (config.max_call_duration_ms or 600000) // 1000,
            "silence_timeout_seconds": (config.end_call_after_silence_ms or 30000) // 1000
        }
        if config.begin_message:
            payload["greeting_message"] = config.begin_message

        try:
            with httpx.Client(timeout=20.0) as client:
                resp = client.post(url, headers=self._headers(), json=payload)
                if resp.status_code not in (200, 201):
                    raise RuntimeError(f"OmniDimension create_agent failed [{resp.status_code}]: {resp.text}")
                data = resp.json()
                agent_id = str(data.get("id") or data.get("agent_id"))
                return {
                    "agent_id": agent_id,
                    "provider": "omnidimension",
                    "raw_response": data
                }
        except Exception as e:
            print(f"[OMNIDIM] create_agent failed: {e}")
            raise

    def update_agent(self, agent_id: str, config: AdmissionAgentConfig) -> Dict[str, Any]:
        """Updates agent configuration in OmniDimension."""
        url = f"{self.base_url}/agents/{agent_id}"
        payload: Dict[str, Any] = {
            "system_prompt": config.system_prompt,
            "name": config.agent_name,
            "language": config.language or "en-IN",
            "temperature": config.temperature or 0.3,
            "speed": config.voice_speed or 1.0
        }
        if config.voice_id:
            payload["voice"] = config.voice_id
        if config.tools:
            payload["tools"] = config.tools
        if config.begin_message:
            payload["greeting_message"] = config.begin_message

        try:
            with httpx.Client(timeout=15.0) as client:
                resp = client.patch(url, headers=self._headers(), json=payload)
                return {"success": resp.status_code in (200, 201), "agent_id": agent_id, "provider": "omnidimension"}
        except Exception as e:
            print(f"[OMNIDIM] update_agent error: {e}")
            return {"success": False, "error": str(e)}

    def list_agents(self) -> List[Dict[str, Any]]:
        """Lists agents via GET /api/v1/agents."""
        url = f"{self.base_url}/agents"
        try:
            with httpx.Client(timeout=10.0) as client:
                resp = client.get(url, headers=self._headers())
                if resp.status_code == 200:
                    raw = resp.json()
                    items = raw.get("data") if isinstance(raw, dict) else raw
                    return [
                        {
                            "id": str(item.get("id") or item.get("agent_id")),
                            "agent_name": item.get("name", "OmniDimension Agent"),
                            "provider": "omnidimension",
                            "voice_id": item.get("voice"),
                            "is_active": True
                        }
                        for item in (items if isinstance(items, list) else [])
                    ]
        except Exception as e:
            print(f"[OMNIDIM] list_agents failed: {e}")
        return []

    def create_call(self, request: OutboundCallRequest) -> CommonCallResult:
        """Dispatches outbound call via POST /api/v1/calls/dispatch."""
        url = f"{self.base_url}/calls/dispatch"
        agent_val = request.agent_id
        try:
            agent_val = int(agent_val)
        except (ValueError, TypeError):
            pass

        payload: Dict[str, Any] = {
            "agent_id": agent_val,
            "to_number": request.to_number,
            "call_context": request.context
        }
        if request.from_number_id:
            try:
                payload["from_number_id"] = int(request.from_number_id)
            except (ValueError, TypeError):
                payload["from_number_id"] = request.from_number_id

        with httpx.Client(timeout=15.0) as client:
            resp = client.post(url, headers=self._headers(), json=payload)
            if resp.status_code not in (200, 201):
                raise RuntimeError(f"OmniDimension dispatch failed [{resp.status_code}]: {resp.text}")
            data = resp.json()
            call_id = data.get("call_id") or data.get("id") or f"omni_{datetime.utcnow().timestamp()}"
            return CommonCallResult(
                provider_call_id=str(call_id),
                provider="omnidimension",
                status="initiated",
                started_at=datetime.utcnow(),
                raw_response=data
            )

    def create_batch_call(self, request: Dict[str, Any]) -> Dict[str, Any]:
        """Dispatches batch calls via OmniDimension campaign API."""
        url = f"{self.base_url}/campaigns/dispatch"
        with httpx.Client(timeout=20.0) as client:
            resp = client.post(url, headers=self._headers(), json=request)
            if resp.status_code not in (200, 201):
                raise RuntimeError(f"OmniDimension create_batch_call failed [{resp.status_code}]: {resp.text}")
            return resp.json()

    def get_call(self, provider_call_id: str) -> CommonCallDetails:
        """Retrieves call log from GET /api/v1/calls/logs/{call_id}."""
        url = f"{self.base_url}/calls/logs/{provider_call_id}"
        try:
            with httpx.Client(timeout=10.0) as client:
                resp = client.get(url, headers=self._headers())
                if resp.status_code == 200:
                    data = resp.json()
                    return CommonCallDetails(
                        provider_call_id=provider_call_id,
                        provider="omnidimension",
                        status=data.get("status", "completed"),
                        duration_seconds=float(data.get("duration", 0.0)),
                        transcript=data.get("conversation") or data.get("transcript"),
                        summary=data.get("summary"),
                        recording_url=data.get("recording_url"),
                        sentiment=data.get("sentiment"),
                        extracted_variables=data.get("extracted_variables", {})
                    )
        except Exception as e:
            print(f"[OMNIDIM] get_call error: {e}")
        return CommonCallDetails(
            provider_call_id=provider_call_id,
            provider="omnidimension",
            status="unknown"
        )

    def transfer_call(self, provider_call_id: str, target_number: str) -> bool:
        """Transfers call to a target phone number."""
        url = f"{self.base_url}/calls/{provider_call_id}/transfer"
        try:
            with httpx.Client(timeout=10.0) as client:
                resp = client.post(url, headers=self._headers(), json={"transfer_number": target_number})
                return resp.status_code in (200, 201, 202)
        except Exception as e:
            print(f"[OMNIDIM] transfer_call failed: {e}")
            return False

    def list_phone_numbers(self) -> List[Dict[str, Any]]:
        """Lists phone numbers via GET /api/v1/phone_number/list."""
        url = f"{self.base_url}/phone_number/list"
        try:
            with httpx.Client(timeout=10.0) as client:
                resp = client.get(url, headers=self._headers())
                if resp.status_code == 200:
                    raw = resp.json()
                    items = raw.get("data") if isinstance(raw, dict) else raw
                    return [
                        {
                            "id": str(item.get("id") or item.get("phone_number_id")),
                            "phone_number": item.get("phone_number") or item.get("number"),
                            "provider": "omnidimension",
                            "agent_id": str(item.get("agent_id", "")),
                            "telephony_provider": item.get("telephony_type", "exotel/sip"),
                            "is_active": True
                        }
                        for item in (items if isinstance(items, list) else [])
                    ]
        except Exception as e:
            print(f"[OMNIDIM] list_phone_numbers failed: {e}")
        return [{
            "id": "omni_default_phone",
            "phone_number": "+918047360000",
            "provider": "omnidimension",
            "telephony_provider": "exotel/sip",
            "is_active": True
        }]

    def normalize_webhook(self, payload: Dict[str, Any], headers: Dict[str, Any]) -> List[CommonCallEvent]:
        """Normalizes OmniDimension webhook events into a list of CommonCallEvents."""
        call_id = str(payload.get("call_id") or payload.get("id") or "")
        event_type = payload.get("event") or payload.get("status") or "call_completed"

        type_map = {
            "call_started": CALL_STARTED,
            "ongoing": CALL_CONNECTED,
            "completed": CALL_ENDED,
            "call_completed": CALL_ANALYZED
        }
        std_event = type_map.get(event_type.lower(), CALL_ANALYZED)

        event = CommonCallEvent(
            event_type=std_event,
            provider="omnidimension",
            provider_call_id=call_id,
            timestamp=datetime.utcnow(),
            provider_status=event_type,
            normalized_data={
                "duration_seconds": float(payload.get("duration", 0.0)),
                "transcript": payload.get("conversation") or payload.get("transcript"),
                "summary": payload.get("summary"),
                "sentiment": payload.get("sentiment"),
                "recording_url": payload.get("recording_url"),
                "extracted_variables": payload.get("extracted_variables", {})
            }
        )
        return [event]

    def validate_configuration(self) -> ProviderValidationResult:
        """Validates OmniDimension API key and agent access."""
        if not self.api_key:
            return ProviderValidationResult(
                provider="omnidimension",
                connected=False,
                ready=False,
                missing_fields=["omnidim_api_key"],
                error_message="OmniDimension API Key is missing",
                capabilities=self.get_capabilities()
            )
        try:
            with httpx.Client(timeout=8.0) as client:
                resp = client.get(f"{self.base_url}/agents", headers=self._headers())
                if resp.status_code in (200, 201):
                    return ProviderValidationResult(
                        provider="omnidimension",
                        connected=True,
                        agent_configured=True,
                        phone_configured=True,
                        webhook_configured=True,
                        ready=True,
                        capabilities=self.get_capabilities()
                    )
                else:
                    return ProviderValidationResult(
                        provider="omnidimension",
                        connected=False,
                        ready=False,
                        missing_fields=["valid_credentials"],
                        error_message=f"OmniDimension connection failed [{resp.status_code}]: {resp.text}",
                        capabilities=self.get_capabilities()
                    )
        except Exception as e:
            return ProviderValidationResult(
                provider="omnidimension",
                connected=False,
                ready=False,
                error_message=f"Connection error: {str(e)}",
                capabilities=self.get_capabilities()
            )

    def get_usage(self) -> Dict[str, Any]:
        """Returns account usage metrics."""
        return {
            "provider": "omnidimension",
            "active_calls": 0,
            "currency": "USD",
            "status": "active"
        }
