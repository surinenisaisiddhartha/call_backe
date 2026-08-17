"""
Provider Capabilities Matrix.
Defines supported capabilities per voice provider so UI and services adapt dynamically.
"""

from typing import Optional
from pydantic import BaseModel


class ProviderCapabilities(BaseModel):
    supports_native_transfer: bool = False
    supports_realtime_transcription: bool = False
    supports_byo_telephony: bool = False
    supports_batch_dispatch: bool = False
    supports_sip_trunking: bool = False

    supports_cost_metrics: bool = False
    supports_custom_tools: bool = False

    supports_recording: bool = False
    supports_post_call_analysis: bool = False
    supports_dynamic_variables: bool = False

    supports_inbound_calls: bool = False
    supports_outbound_calls: bool = False

    supports_phone_number_management: bool = False
    supports_agent_provisioning: bool = False

    max_concurrency: Optional[int] = None
