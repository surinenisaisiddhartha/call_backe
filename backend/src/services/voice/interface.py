"""
Voice Provider Base Interface.
All voice provider adapters (Retell, OmniDimension, Bolna) inherit from this interface.
"""

from abc import ABC, abstractmethod
from typing import List, Dict, Any, Optional
from src.services.voice.capabilities import ProviderCapabilities
from src.services.voice.models import (
    OutboundCallRequest,
    CommonCallResult,
    CommonCallDetails,
    CommonCallEvent,
    ProviderValidationResult,
    AdmissionAgentConfig
)


class VoiceProvider(ABC):
    @property
    @abstractmethod
    def provider_name(self) -> str:
        """Returns provider identifier: 'retell', 'omnidimension', 'bolna'."""
        pass

    # Capability
    @abstractmethod
    def get_capabilities(self) -> ProviderCapabilities:
        """Returns capability flags for this provider."""
        pass

    # Agent
    @abstractmethod
    def create_agent(self, config: AdmissionAgentConfig) -> Dict[str, Any]:
        """Creates or provisions an admission agent with the given configuration."""
        pass

    @abstractmethod
    def update_agent(self, agent_id: str, config: AdmissionAgentConfig) -> Dict[str, Any]:
        """Updates system prompt, tools, or settings for an existing agent."""
        pass

    @abstractmethod
    def list_agents(self) -> List[Dict[str, Any]]:
        """Lists configured voice agents under this provider."""
        pass

    # Calling
    @abstractmethod
    def create_call(self, request: OutboundCallRequest) -> CommonCallResult:
        """Dispatches an outbound phone call."""
        pass

    @abstractmethod
    def create_batch_call(self, request: Dict[str, Any]) -> Dict[str, Any]:
        """Dispatches a batch of outbound phone calls."""
        pass

    @abstractmethod
    def get_call(self, provider_call_id: str) -> CommonCallDetails:
        """Retrieves details, logs, transcript, and recording for a call."""
        pass

    # Transfer
    @abstractmethod
    def transfer_call(self, provider_call_id: str, target_number: str) -> bool:
        """Transfers an ongoing call to a target phone number."""
        pass

    # Phone numbers
    @abstractmethod
    def list_phone_numbers(self) -> List[Dict[str, Any]]:
        """Lists configured/purchased phone numbers under this provider."""
        pass

    # Webhooks
    @abstractmethod
    def normalize_webhook(self, payload: Dict[str, Any], headers: Dict[str, Any]) -> List[CommonCallEvent]:
        """Normalizes provider-specific webhook into a list of standard CommonCallEvents."""
        pass

    # Provider validation
    @abstractmethod
    def validate_configuration(self) -> ProviderValidationResult:
        """Tests API connection, agent presence, phone number, and webhook."""
        pass

    # Usage / economics
    @abstractmethod
    def get_usage(self) -> Dict[str, Any]:
        """Retrieves account usage, balance, or billing metrics from the provider."""
        pass
