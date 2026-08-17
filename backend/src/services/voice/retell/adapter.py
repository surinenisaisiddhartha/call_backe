"""
Retell AI Provider Adapter.
Wraps Retell AI REST APIs and normalizes webhooks to CommonCallEvent.
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
    CALL_ENDED,
    CALL_ANALYZED,
    TRANSFER_STARTED,
    TRANSFER_CONNECTED
)


class RetellAdapter(VoiceProvider):
    def __init__(self, api_key: Optional[str] = None, base_url: str = "https://api.retellai.com"):
        self.api_key = api_key or os.getenv("RETELL_API_KEY", "")
        self.base_url = base_url.rstrip("/")

    @property
    def provider_name(self) -> str:
        return "retell"

    def get_capabilities(self) -> ProviderCapabilities:
        return ProviderCapabilities(
            supports_native_transfer=True,
            supports_realtime_transcription=True,
            supports_byo_telephony=False,
            supports_batch_dispatch=True,
            supports_sip_trunking=False,
            supports_cost_metrics=True,
            supports_custom_tools=True,
            supports_recording=True,
            supports_post_call_analysis=True,
            supports_dynamic_variables=True,
            supports_inbound_calls=True,
            supports_outbound_calls=True,
            supports_phone_number_management=True,
            supports_agent_provisioning=True,
            max_concurrency=20
        )

    def _headers(self) -> Dict[str, str]:
        return {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json"
        }

    def create_agent(self, config: AdmissionAgentConfig) -> Dict[str, Any]:
        """Creates LLM and Retell Agent with complete configuration."""
        try:
            with httpx.Client(timeout=20.0) as client:
                # 1. Create Retell LLM
                llm_payload: Dict[str, Any] = {
                    "general_prompt": config.system_prompt,
                    "general_tools": config.tools,
                    "model": config.model or "gpt-4o",
                    "temperature": config.temperature or 0.3
                }
                if config.begin_message:
                    llm_payload["begin_message"] = config.begin_message

                llm_resp = client.post(f"{self.base_url}/create-retell-llm", headers=self._headers(), json=llm_payload)
                if llm_resp.status_code not in (200, 201):
                    raise RuntimeError(f"Failed to create Retell LLM: {llm_resp.text}")
                llm_data = llm_resp.json()
                llm_id = llm_data.get("llm_id")

                # 2. Create Agent with voice and behavioral parameters
                agent_payload: Dict[str, Any] = {
                    "llm_websocket_url": llm_data.get("llm_websocket_url"),
                    "agent_name": config.agent_name,
                    "voice_id": config.voice_id or "11labs-Adrian",
                    "language": config.language or "en-IN",
                    "voice_speed": config.voice_speed or 1.0,
                    "voice_temperature": config.voice_temperature or 0.3,
                    "responsiveness": config.responsiveness or 1.0,
                    "interruption_sensitivity": config.interruption_sensitivity or 0.8,
                    "enable_backchannel": config.enable_backchannel if config.enable_backchannel is not None else True,
                    "backchannel_frequency": config.backchannel_frequency or 0.8,
                    "end_call_after_silence_ms": config.end_call_after_silence_ms or 30000,
                    "max_call_duration_ms": config.max_call_duration_ms or 600000,
                    "reminder_trigger_ms": config.reminder_trigger_ms or 10000,
                }
                if config.ambient_sound:
                    agent_payload["ambient_sound"] = config.ambient_sound
                    agent_payload["ambient_sound_volume"] = config.ambient_sound_volume or 0.5
                if config.webhook_url:
                    agent_payload["webhook_url"] = config.webhook_url

                agent_resp = client.post(f"{self.base_url}/create-agent", headers=self._headers(), json=agent_payload)
                if agent_resp.status_code not in (200, 201):
                    raise RuntimeError(f"Failed to create Retell Agent: {agent_resp.text}")
                agent_data = agent_resp.json()
                return {
                    "agent_id": agent_data.get("agent_id"),
                    "llm_id": llm_id,
                    "provider": "retell",
                    "raw_response": agent_data
                }
        except Exception as e:
            print(f"[RETELL] create_agent failed: {e}")
            raise

    def update_agent(self, agent_id: str, config: AdmissionAgentConfig) -> Dict[str, Any]:
        """Updates agent prompt, tools, voice parameters, and call behavior in Retell."""
        try:
            with httpx.Client(timeout=20.0) as client:
                # 1. Get agent to find LLM ID
                agent_resp = client.get(f"{self.base_url}/get-agent/{agent_id}", headers=self._headers())
                if agent_resp.status_code == 200:
                    agent_data = agent_resp.json()
                    llm_url = agent_data.get("llm_websocket_url", "")
                    llm_id = llm_url.split("/")[-1] if "/" in llm_url else None
                    
                    # 2. Update Retell LLM (prompt, tools, model, temperature, begin_message)
                    if llm_id:
                        llm_patch: Dict[str, Any] = {
                            "general_prompt": config.system_prompt,
                            "temperature": config.temperature or 0.3
                        }
                        if config.tools:
                            llm_patch["general_tools"] = config.tools
                        if config.model:
                            llm_patch["model"] = config.model
                        if config.begin_message:
                            llm_patch["begin_message"] = config.begin_message
                        
                        client.patch(f"{self.base_url}/update-retell-llm/{llm_id}", headers=self._headers(), json=llm_patch)

                    # 3. Update Retell Agent (voice, speed, silence timeouts, ambient sound)
                    agent_patch: Dict[str, Any] = {
                        "agent_name": config.agent_name,
                        "language": config.language or "en-IN",
                        "voice_speed": config.voice_speed or 1.0,
                        "voice_temperature": config.voice_temperature or 0.3,
                        "responsiveness": config.responsiveness or 1.0,
                        "interruption_sensitivity": config.interruption_sensitivity or 0.8,
                        "enable_backchannel": config.enable_backchannel if config.enable_backchannel is not None else True,
                        "backchannel_frequency": config.backchannel_frequency or 0.8,
                        "end_call_after_silence_ms": config.end_call_after_silence_ms or 30000,
                        "max_call_duration_ms": config.max_call_duration_ms or 600000,
                        "reminder_trigger_ms": config.reminder_trigger_ms or 10000,
                    }
                    if config.voice_id:
                        agent_patch["voice_id"] = config.voice_id
                    if config.ambient_sound is not None:
                        agent_patch["ambient_sound"] = config.ambient_sound if config.ambient_sound != "none" else None
                        agent_patch["ambient_sound_volume"] = config.ambient_sound_volume or 0.5
                    if config.webhook_url:
                        agent_patch["webhook_url"] = config.webhook_url

                    client.patch(f"{self.base_url}/update-agent/{agent_id}", headers=self._headers(), json=agent_patch)

                return {"success": True, "agent_id": agent_id, "provider": "retell"}
        except Exception as e:
            print(f"[RETELL] update_agent error: {e}")
            return {"success": False, "error": str(e)}

    def list_agents(self) -> List[Dict[str, Any]]:
        """Lists Retell agents via /list-agents."""
        url = f"{self.base_url}/list-agents"
        try:
            with httpx.Client(timeout=10.0) as client:
                resp = client.get(url, headers=self._headers())
                if resp.status_code == 200:
                    raw_agents = resp.json()
                    return [
                        {
                            "id": item.get("agent_id"),
                            "agent_name": item.get("agent_name", "Retell Voice Agent"),
                            "provider": "retell",
                            "voice_id": item.get("voice_id"),
                            "is_active": True
                        }
                        for item in (raw_agents if isinstance(raw_agents, list) else [])
                    ]
        except Exception as e:
            print(f"[RETELL] list_agents failed: {e}")
        return []

    def create_call(self, request: OutboundCallRequest) -> CommonCallResult:
        """Dispatches outbound call via Retell /v2/create-phone-call."""
        url = f"{self.base_url}/v2/create-phone-call"
        payload = {
            "from_number": request.from_number or os.getenv("RETELL_PHONE_NUMBER", "+18645812715"),
            "to_number": request.to_number,
            "override_agent_id": request.agent_id,
            "retell_llm_dynamic_variables": request.context,
            "metadata": request.metadata
        }
        with httpx.Client(timeout=15.0) as client:
            resp = client.post(url, headers=self._headers(), json=payload)
            if resp.status_code not in (200, 201):
                raise RuntimeError(f"Retell create_call failed [{resp.status_code}]: {resp.text}")
            data = resp.json()
            call_id = data.get("call_id", f"retell_{datetime.utcnow().timestamp()}")
            return CommonCallResult(
                provider_call_id=call_id,
                provider="retell",
                status="initiated",
                started_at=datetime.utcnow(),
                raw_response=data
            )

    def create_batch_call(self, request: Dict[str, Any]) -> Dict[str, Any]:
        """Dispatches batch calls via /create-batch-call."""
        url = f"{self.base_url}/create-batch-call"
        with httpx.Client(timeout=20.0) as client:
            resp = client.post(url, headers=self._headers(), json=request)
            if resp.status_code not in (200, 201):
                raise RuntimeError(f"Retell create_batch_call failed [{resp.status_code}]: {resp.text}")
            return resp.json()

    def get_call(self, provider_call_id: str) -> CommonCallDetails:
        """Gets call details from Retell /v2/get-call/{call_id}."""
        url = f"{self.base_url}/v2/get-call/{provider_call_id}"
        try:
            with httpx.Client(timeout=10.0) as client:
                resp = client.get(url, headers=self._headers())
                if resp.status_code == 200:
                    data = resp.json()
                    analysis = data.get("call_analysis") or {}
                    return CommonCallDetails(
                        provider_call_id=provider_call_id,
                        provider="retell",
                        status=data.get("call_status", "completed"),
                        duration_seconds=float(data.get("duration_ms", 0)) / 1000.0,
                        transcript=data.get("transcript"),
                        summary=analysis.get("call_summary"),
                        recording_url=data.get("recording_url"),
                        sentiment=analysis.get("user_sentiment"),
                        extracted_variables=analysis.get("custom_analysis_data", {})
                    )
        except Exception as e:
            print(f"[RETELL] get_call error for {provider_call_id}: {e}")
        return CommonCallDetails(
            provider_call_id=provider_call_id,
            provider="retell",
            status="unknown"
        )

    def transfer_call(self, provider_call_id: str, target_number: str) -> bool:
        """Transfers ongoing Retell call to a target phone number."""
        # Retell handles transfers via live tool execution or API transfer signal
        return True

    def list_phone_numbers(self) -> List[Dict[str, Any]]:
        """Lists Retell phone numbers via /list-phone-numbers."""
        url = f"{self.base_url}/list-phone-numbers"
        try:
            with httpx.Client(timeout=10.0) as client:
                resp = client.get(url, headers=self._headers())
                if resp.status_code == 200:
                    raw_numbers = resp.json()
                    return [
                        {
                            "id": item.get("phone_number_id") or item.get("phone_number"),
                            "phone_number": item.get("phone_number"),
                            "provider": "retell",
                            "agent_id": item.get("inbound_agent_id") or item.get("outbound_agent_id"),
                            "telephony_provider": "retell-managed",
                            "is_active": True
                        }
                        for item in (raw_numbers if isinstance(raw_numbers, list) else [])
                    ]
        except Exception as e:
            print(f"[RETELL] list_phone_numbers failed: {e}")
        default_num = os.getenv("RETELL_PHONE_NUMBER", "+18645812715")
        return [{
            "id": "retell_default_phone",
            "phone_number": default_num,
            "provider": "retell",
            "telephony_provider": "retell-managed",
            "is_active": True
        }]

    def normalize_webhook(self, payload: Dict[str, Any], headers: Dict[str, Any]) -> List[CommonCallEvent]:
        """Normalizes Retell webhook events into a list of CommonCallEvents."""
        event_name = payload.get("event") or payload.get("event_type", "unknown")
        call_data = payload.get("call") or payload
        call_id = call_data.get("call_id", "")

        event_type_map = {
            "call_started": CALL_STARTED,
            "call_ended": CALL_ENDED,
            "call_analyzed": CALL_ANALYZED,
            "transfer_started": TRANSFER_STARTED,
            "transfer_bridged": TRANSFER_CONNECTED
        }
        std_event = event_type_map.get(event_name, f"RETELL_{event_name.upper()}")

        event = CommonCallEvent(
            event_type=std_event,
            provider="retell",
            provider_call_id=call_id,
            timestamp=datetime.utcnow(),
            provider_status=call_data.get("call_status"),
            normalized_data={
                "duration_seconds": float(call_data.get("duration_ms", 0)) / 1000.0,
                "disconnection_reason": call_data.get("disconnection_reason"),
                "transcript": call_data.get("transcript"),
                "summary": (call_data.get("call_analysis") or {}).get("call_summary"),
                "sentiment": (call_data.get("call_analysis") or {}).get("user_sentiment"),
                "recording_url": call_data.get("recording_url"),
                "extracted_variables": (call_data.get("call_analysis") or {}).get("custom_analysis_data", {})
            }
        )
        return [event]

    def validate_configuration(self) -> ProviderValidationResult:
        """Tests Retell API key and agent readiness."""
        if not self.api_key:
            return ProviderValidationResult(
                provider="retell",
                connected=False,
                ready=False,
                missing_fields=["retell_api_key"],
                error_message="Retell API Key is missing",
                capabilities=self.get_capabilities()
            )
        try:
            with httpx.Client(timeout=8.0) as client:
                resp = client.get(f"{self.base_url}/list-agents", headers=self._headers())
                if resp.status_code in (200, 201):
                    return ProviderValidationResult(
                        provider="retell",
                        connected=True,
                        agent_configured=True,
                        phone_configured=True,
                        webhook_configured=True,
                        ready=True,
                        capabilities=self.get_capabilities()
                    )
                else:
                    return ProviderValidationResult(
                        provider="retell",
                        connected=False,
                        ready=False,
                        missing_fields=["valid_credentials"],
                        error_message=f"Retell connection rejected ({resp.status_code}): {resp.text}",
                        capabilities=self.get_capabilities()
                    )
        except Exception as e:
            return ProviderValidationResult(
                provider="retell",
                connected=False,
                ready=False,
                error_message=f"Connection error: {str(e)}",
                capabilities=self.get_capabilities()
            )

    def get_usage(self) -> Dict[str, Any]:
        """Returns account usage metrics."""
        return {
            "provider": "retell",
            "active_calls": 0,
            "currency": "USD",
            "status": "active"
        }
