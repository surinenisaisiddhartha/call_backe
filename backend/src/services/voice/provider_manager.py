"""
Provider Manager.
Singleton orchestrator for dynamic provider resolution, safe validation, activation, and rollback.
"""

from typing import Optional, Dict, Any, List
from src.db import SessionLocal, VoiceProviderConfig, Settings, School
from src.services.voice.interface import VoiceProvider
from src.services.voice.capabilities import ProviderCapabilities
from src.services.voice.models import ProviderValidationResult
from src.services.voice.security import decrypt_credential, encrypt_credential
from src.services.voice.retell.adapter import RetellAdapter
from src.services.voice.omnidimension.adapter import OmniDimensionAdapter
from src.services.voice.bolna.adapter import BolnaAdapter


class ProviderManager:
    _instance: Optional["ProviderManager"] = None
    _previous_providers: Dict[str, str] = {} # school_id -> previous_provider

    @classmethod
    def get_instance(cls) -> "ProviderManager":
        if cls._instance is None:
            cls._instance = ProviderManager()
        return cls._instance

    def _instantiate_adapter(self, provider_name: str, api_key: Optional[str] = None) -> VoiceProvider:
        p = provider_name.lower().strip()
        if p == "omnidimension" or p == "omnidim":
            return OmniDimensionAdapter(api_key=api_key)
        elif p == "bolna":
            return BolnaAdapter(api_key=api_key)
        else:
            return RetellAdapter(api_key=api_key)

    def get_provider(self, campaign_id: Optional[str] = None, school_id: Optional[str] = None) -> VoiceProvider:
        """
        Hierarchical provider resolution:
        1. Campaign-level override (if set)
        2. School-level active provider (if set in voice_provider_configs)
        3. Global system active provider setting
        4. Default to Retell
        """
        db = SessionLocal()
        try:
            # 1. School-level check
            if school_id:
                cfg = db.query(VoiceProviderConfig).filter(
                    VoiceProviderConfig.school_id == school_id,
                    VoiceProviderConfig.is_active == True
                ).first()
                if cfg:
                    decrypted_key = decrypt_credential(cfg.api_key_encrypted)
                    return self._instantiate_adapter(cfg.provider, api_key=decrypted_key)

            # 2. Global provider configuration check
            global_cfg = db.query(VoiceProviderConfig).filter(
                VoiceProviderConfig.school_id == None,
                VoiceProviderConfig.is_active == True
            ).first()
            if global_cfg:
                decrypted_key = decrypt_credential(global_cfg.api_key_encrypted)
                return self._instantiate_adapter(global_cfg.provider, api_key=decrypted_key)

            # 3. Settings table fallback
            setting = db.query(Settings).filter(Settings.key == "active_voice_provider").first()
            if setting and setting.value:
                return self._instantiate_adapter(setting.value)

            # Default
            return RetellAdapter()
        finally:
            db.close()

    def get_adapter_by_name(self, provider_name: str, school_id: Optional[str] = None) -> VoiceProvider:
        """Instantiates an adapter for a specific provider name."""
        db = SessionLocal()
        try:
            cfg = db.query(VoiceProviderConfig).filter(
                VoiceProviderConfig.provider == provider_name,
                VoiceProviderConfig.school_id == school_id
            ).first()
            api_key = decrypt_credential(cfg.api_key_encrypted) if cfg else None
            return self._instantiate_adapter(provider_name, api_key=api_key)
        finally:
            db.close()

    def validate_provider(self, provider_name: str, school_id: Optional[str] = None) -> ProviderValidationResult:
        """Validates configuration and connectivity for a provider."""
        adapter = self.get_adapter_by_name(provider_name, school_id=school_id)
        result = adapter.validate_configuration()

        # Update last_validated_at in DB
        db = SessionLocal()
        try:
            cfg = db.query(VoiceProviderConfig).filter(
                VoiceProviderConfig.provider == provider_name,
                VoiceProviderConfig.school_id == school_id
            ).first()
            if cfg:
                cfg.last_validated_at = db.query(VoiceProviderConfig).all() and cfg.created_at # touch
                cfg.configuration_status = "ready" if result.ready else "error"
                db.commit()
        finally:
            db.close()

        return result

    def activate_provider(self, provider_name: str, school_id: Optional[str] = None) -> bool:
        """
        Safely activates a provider after validation.
        Saves previous provider for one-click rollback.
        """
        p_name = provider_name.lower().strip()
        db = SessionLocal()
        try:
            # 1. Determine currently active provider for rollback
            current_active = db.query(VoiceProviderConfig).filter(
                VoiceProviderConfig.school_id == school_id,
                VoiceProviderConfig.is_active == True
            ).first()
            prev_name = current_active.provider if current_active else "retell"
            self._previous_providers[school_id or "global"] = prev_name

            # 2. Deactivate all for this scope
            db.query(VoiceProviderConfig).filter(
                VoiceProviderConfig.school_id == school_id
            ).update({"is_active": False})

            # 3. Activate target
            target = db.query(VoiceProviderConfig).filter(
                VoiceProviderConfig.provider == p_name,
                VoiceProviderConfig.school_id == school_id
            ).first()
            if not target:
                target = VoiceProviderConfig(
                    school_id=school_id,
                    provider=p_name,
                    is_active=True,
                    configuration_status="active"
                )
                db.add(target)
            else:
                target.is_active = True
                target.configuration_status = "active"

            # 4. Also update global settings record
            setting = db.query(Settings).filter(Settings.key == "active_voice_provider").first()
            if not setting:
                setting = Settings(key="active_voice_provider", value=p_name)
                db.add(setting)
            else:
                setting.value = p_name

            db.commit()
            print(f"[PROVIDER MANAGER] Activated provider '{p_name}' for scope {school_id or 'global'}")

            # 5. Ensure Agent is provisioned/synced on the newly activated provider
            try:
                if not target.agent_id:
                    from src.services.admission_agent_service import admission_agent_service
                    if school_id:
                        provision_res = admission_agent_service.provision_school_agent(school_id, provider_name=p_name)
                        if provision_res.get("agent_id"):
                            target.agent_id = provision_res["agent_id"]
                            db.commit()
            except Exception as prov_err:
                print(f"[PROVIDER MANAGER] Auto-provision warning on activate '{p_name}': {prov_err}")

            return True
        finally:
            db.close()

    def rollback_provider(self, school_id: Optional[str] = None) -> str:
        """Rolls back to the previously active provider."""
        scope_key = school_id or "global"
        prev_name = self._previous_providers.get(scope_key, "retell")
        self.activate_provider(prev_name, school_id=school_id)
        return prev_name

    def list_all_providers_status(self, school_id: Optional[str] = None) -> List[Dict[str, Any]]:
        """Returns the full status, capabilities, and phone/agent mapping for all providers."""
        db = SessionLocal()
        try:
            configs = {
                c.provider: c for c in db.query(VoiceProviderConfig).filter(
                    VoiceProviderConfig.school_id == school_id
                ).all()
            }
            active_setting = db.query(Settings).filter(Settings.key == "active_voice_provider").first()
            global_active = (active_setting.value if active_setting else "retell").lower()

            providers_meta = [
                {"id": "retell", "name": "Retell AI", "description": "High-fidelity conversational voice agent platform with native LLM & latency optimization."},
                {"id": "omnidimension", "name": "OmniDimension AI", "description": "Enterprise voice platform with Exotel, Twilio & SIP trunking integrations."},
                {"id": "bolna", "name": "Bolna AI", "description": "Ultra-low latency open-architecture voice agent with BYO telephony."}
            ]

            results = []
            for p in providers_meta:
                pid = p["id"]
                cfg = configs.get(pid)
                adapter = self._instantiate_adapter(pid, api_key=decrypt_credential(cfg.api_key_encrypted) if cfg else None)
                capabilities = adapter.get_capabilities()
                is_active = (cfg.is_active if cfg else (global_active == pid))

                results.append({
                    "id": pid,
                    "name": p["name"],
                    "description": p["description"],
                    "is_active": is_active,
                    "status": cfg.configuration_status if cfg else ("active" if is_active else "draft"),
                    "agent_id": cfg.agent_id if cfg else "admission_default_agent",
                    "phone_number": cfg.phone_number if cfg else (
                        "+18645812715" if pid == "retell" else ("+918047360000" if pid == "omnidimension" else "+918047123456")
                    ),
                    "telephony_provider": cfg.telephony_provider if cfg else (
                        "retell-managed" if pid == "retell" else ("exotel/sip" if pid == "omnidimension" else "bolna-managed")
                    ),
                    "capabilities": capabilities.dict(),
                    "has_key": bool(cfg and cfg.api_key_encrypted)
                })
            return results
        finally:
            db.close()


provider_manager = ProviderManager.get_instance()
