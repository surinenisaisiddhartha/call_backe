"""
Providers & Platform Management Router.
Handles Voice Provider switching, validation, editable billing rates, competitor intelligence, and logs.
"""

import json
from datetime import datetime
from typing import List, Dict, Any, Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import or_, func
from pydantic import BaseModel
from src.db import (
    get_db,
    VoiceProviderConfig,
    ProviderPhoneNumber,
    BillingRateVersion,
    CustomerPricingVersion,
    SchoolBillingSettings,
    CallCostSnapshot,
    ProviderWebhookEvent,
    CompetitorComparison,
    CallAttempt,
    Contact,
    School
)
from src.routers.auth import get_current_user
from src.services.voice.provider_manager import provider_manager
from src.services.voice.security import encrypt_credential, mask_secret
from src.services.billing_engine import (
    ensure_default_rate_versions,
    create_new_rate_version,
    create_new_customer_pricing_version
)

router = APIRouter(prefix="/api/providers", tags=["Voice Providers & Platform"])


# ── Pydantic Request Models ──────────────────────────────────────────

class ProviderConfigUpdate(BaseModel):
    api_key: Optional[str] = None
    agent_id: Optional[str] = None
    phone_number: Optional[str] = None
    telephony_provider: Optional[str] = None
    webhook_url: Optional[str] = None


class RateUpdateModel(BaseModel):
    provider: str
    platform_rate_per_min: Optional[float] = None
    telephony_rate_per_min: Optional[float] = None
    stt_rate_per_min: Optional[float] = None
    llm_rate_per_min: Optional[float] = None
    tts_rate_per_min: Optional[float] = None
    total_cost_per_min: Optional[float] = None
    total_cost_inr_per_min: Optional[float] = None
    currency: str = "USD"


class MarkupSettingsModel(BaseModel):
    markup_type: str = "percentage"  # percentage, fixed_per_min, fixed_per_call
    markup_value: float = 20.0
    currency: str = "INR"
    tax_rate_percent: float = 18.0
    pricing_model: Optional[str] = "per_minute"  # per_minute, fixed_per_call


class CallCostUpdateModel(BaseModel):
    provider_total_cost: Optional[float] = None
    customer_billable_total: Optional[float] = None
    adjustment_reason: Optional[str] = None


class CompetitorCreateModel(BaseModel):
    competitor_name: str
    key_advantages: str
    curriculum_comparison: Optional[str] = None
    ratio_comparison: Optional[str] = None
    facilities_comparison: Optional[str] = None
    objection_scripts: Optional[str] = None


# ── Provider Management Endpoints ────────────────────────────────────

@router.get("")
def list_providers(
    school_id: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """Lists all voice providers with their connection status, capabilities, and configurations."""
    target_school_id = school_id or current_user.get("school_id")
    return provider_manager.list_all_providers_status(school_id=target_school_id)


@router.get("/active")
def get_active_provider(
    school_id: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """Returns currently active voice provider."""
    target_school_id = school_id or current_user.get("school_id")
    active_adapter = provider_manager.get_provider(school_id=target_school_id)
    return {
        "active_provider": active_adapter.provider_name,
        "capabilities": active_adapter.get_capabilities().dict()
    }


@router.post("/{provider_name}/validate")
def validate_provider(
    provider_name: str,
    school_id: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """Runs a connection and configuration test for the specified provider."""
    target_school_id = school_id or current_user.get("school_id")
    result = provider_manager.validate_provider(provider_name, school_id=target_school_id)
    return result.dict()


@router.post("/{provider_name}/activate")
def activate_provider(
    provider_name: str,
    school_id: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """Safely activates the chosen voice provider for a specific school or globally."""
    target_school_id = school_id or current_user.get("school_id")
    success = provider_manager.activate_provider(provider_name, school_id=target_school_id)
    return {"success": success, "active_provider": provider_name, "school_id": target_school_id}


@router.get("/{provider_name}/capabilities")
def get_provider_capabilities(
    provider_name: str,
    school_id: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """Returns granular capability flags for a specific provider."""
    target_school_id = school_id or current_user.get("school_id")
    adapter = provider_manager.get_adapter_by_name(provider_name, school_id=target_school_id)
    return {
        "provider": provider_name,
        "capabilities": adapter.get_capabilities().dict()
    }


@router.get("/{provider_name}/health")
def get_provider_health(
    provider_name: str,
    school_id: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """Returns real-time health and connectivity status for a provider."""
    target_school_id = school_id or current_user.get("school_id")
    result = provider_manager.validate_provider(provider_name, school_id=target_school_id)
    return {
        "provider": provider_name,
        "healthy": result.connected and result.ready,
        "connected": result.connected,
        "ready": result.ready,
        "missing_fields": result.missing_fields,
        "error": result.error_message
    }


@router.get("/{provider_name}/agents")
def list_provider_agents(
    provider_name: str,
    school_id: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """Lists voice agents registered on the target provider."""
    target_school_id = school_id or current_user.get("school_id")
    adapter = provider_manager.get_adapter_by_name(provider_name, school_id=target_school_id)
    agents = adapter.list_agents()
    return {
        "provider": provider_name,
        "agents": agents,
        "count": len(agents)
    }


@router.get("/{provider_name}/phone-numbers")
def list_provider_phone_numbers(
    provider_name: str,
    school_id: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """Lists purchased/managed caller ID phone numbers for the provider."""
    target_school_id = school_id or current_user.get("school_id")
    adapter = provider_manager.get_adapter_by_name(provider_name, school_id=target_school_id)
    numbers = adapter.list_phone_numbers()
    return {
        "provider": provider_name,
        "phone_numbers": numbers,
        "count": len(numbers)
    }


@router.post("/rollback")
def rollback_provider(
    school_id: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """Rolls back to previously active provider."""
    target_school_id = school_id or current_user.get("school_id")
    reverted_name = provider_manager.rollback_provider(school_id=target_school_id)
    return {"success": True, "active_provider": reverted_name}


@router.post("/{provider_name}/config")
def save_provider_config(
    provider_name: str,
    data: ProviderConfigUpdate,
    school_id: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """Saves encrypted credentials and agent/phone settings for a provider."""
    target_school_id = school_id or current_user.get("school_id")
    p_name = provider_name.lower().strip()

    cfg = db.query(VoiceProviderConfig).filter(
        VoiceProviderConfig.provider == p_name,
        VoiceProviderConfig.school_id == target_school_id
    ).first()

    if not cfg:
        cfg = VoiceProviderConfig(
            provider=p_name,
            school_id=target_school_id,
            configuration_status="draft"
        )
        db.add(cfg)

    if data.api_key:
        cfg.api_key_encrypted = encrypt_credential(data.api_key)
    if data.agent_id is not None:
        cfg.agent_id = data.agent_id
    if data.phone_number is not None:
        cfg.phone_number = data.phone_number
    if data.telephony_provider is not None:
        cfg.telephony_provider = data.telephony_provider
    if data.webhook_url is not None:
        cfg.webhook_url = data.webhook_url

    cfg.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(cfg)
    return {"success": True, "provider": p_name, "status": cfg.configuration_status}


# ── Dual-Layer Billing & Rates Endpoints ─────────────────────────────

@router.get("/rates")
def get_billing_rates(
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """Returns current provider base rates, historical versions, and SaaS markup settings."""
    ensure_default_rate_versions(db)
    school_id = current_user.get("school_id")

    current_rates = db.query(BillingRateVersion).filter(
        BillingRateVersion.is_current == True
    ).all()

    all_versions = db.query(BillingRateVersion).order_by(
        BillingRateVersion.created_at.desc()
    ).limit(30).all()

    markup_settings = db.query(SchoolBillingSettings).filter(
        SchoolBillingSettings.school_id == school_id
    ).first()
    if not markup_settings:
        markup_settings = db.query(SchoolBillingSettings).filter(
            SchoolBillingSettings.school_id == None
        ).first()

    # Compute real usage and metrics from CallAttempt and CallCostSnapshot
    from src.db import CallAttempt, CallCostSnapshot, Contact
    
    call_query = db.query(CallAttempt)
    if school_id:
        call_query = call_query.outerjoin(Contact, CallAttempt.contact_id == Contact.id).filter(
            or_(
                CallAttempt.school_id == school_id,
                Contact.school_id == school_id
            )
        )
        
    total_calls = call_query.count()
    total_sec = call_query.with_entities(func.coalesce(func.sum(CallAttempt.duration_sec), 0)).scalar() or 0
    total_minutes = round(total_sec / 60.0, 1)

    snap_query = db.query(CallCostSnapshot)
    if school_id:
        snap_query = snap_query.outerjoin(CallAttempt, CallCostSnapshot.call_attempt_id == CallAttempt.id)\
                               .outerjoin(Contact, CallAttempt.contact_id == Contact.id)\
                               .filter(
                                   or_(
                                       CallCostSnapshot.school_id == school_id,
                                       CallAttempt.school_id == school_id,
                                       Contact.school_id == school_id
                                   )
                               )

    total_billed = snap_query.with_entities(func.coalesce(func.sum(CallCostSnapshot.customer_billable_total), 0)).scalar() or 0.0
    total_actual = snap_query.with_entities(func.coalesce(func.sum(CallCostSnapshot.provider_total_cost), 0)).scalar() or 0.0

    # Fallback to standard ₹15.00/min rate (+ 18% GST) if snapshots are pending
    RATE_PER_MIN = 15.00
    TAX_MULTIPLIER = 1.18
    if total_billed == 0.0 and total_minutes > 0:
        total_billed = round(total_minutes * RATE_PER_MIN * TAX_MULTIPLIER, 2)
        total_actual = round(total_minutes * (0.08 * 83.50), 2)

    # Build real invoice statements grouped by month matching 1:1 between admin and school
    snapshots = snap_query.order_by(CallCostSnapshot.created_at.desc()).all()
    invoices = []
    monthly_groups = {}

    if snapshots:
        for s in snapshots:
            month_key = s.created_at.strftime("%Y-%m")
            if month_key not in monthly_groups:
                monthly_groups[month_key] = {
                    "id": f"INV-{month_key}",
                    "date": s.created_at.strftime("%d %b %Y"),
                    "period": f"{s.created_at.strftime('%b %Y')} Usage",
                    "minutes": 0.0,
                    "calls": 0,
                    "amount": 0.0,
                    "currency": s.currency or "INR",
                    "status": "Paid"
                }
            monthly_groups[month_key]["minutes"] += round((s.duration_sec or 0) / 60.0, 1)
            monthly_groups[month_key]["calls"] += 1
            monthly_groups[month_key]["amount"] += (s.customer_billable_total or 0.0)
    elif total_minutes > 0:
        now = datetime.utcnow()
        month_key = now.strftime("%Y-%m")
        monthly_groups[month_key] = {
            "id": f"INV-{month_key}",
            "date": now.strftime("%d %b %Y"),
            "period": f"{now.strftime('%b %Y')} Usage",
            "minutes": total_minutes,
            "calls": total_calls,
            "amount": total_billed,
            "currency": "INR",
            "status": "Paid"
        }

    for m_key, inv in monthly_groups.items():
        symbol = "₹" if inv["currency"] == "INR" else "$"
        invoices.append({
            "id": inv["id"],
            "date": inv["date"],
            "period": inv["period"],
            "minutes": round(inv["minutes"], 1),
            "calls": inv["calls"],
            "amount": f"{symbol}{inv['amount']:,.2f}",
            "status": inv["status"]
        })

    from src.dialer import dialer
    active_channels = dialer.get_active_calls()

    active_adapter = provider_manager.get_provider(school_id=school_id)
    active_provider_name = active_adapter.provider_name
    active_provider_title = (
        "Retell AI" if active_provider_name == "retell"
        else "OmniDimension AI" if active_provider_name == "omnidimension"
        else "Bolna AI"
    )

    return {
        "active_provider": active_provider_name,
        "active_provider_title": active_provider_title,
        "current_rates": [
            {
                "id": r.id,
                "version_number": r.version_number,
                "provider": r.provider,
                "platform_rate_per_min": r.platform_rate_per_min,
                "telephony_rate_per_min": r.telephony_rate_per_min,
                "stt_rate_per_min": r.stt_rate_per_min,
                "llm_rate_per_min": r.llm_rate_per_min,
                "tts_rate_per_min": r.tts_rate_per_min,
                "total_per_min": round(
                    r.platform_rate_per_min + r.telephony_rate_per_min +
                    r.stt_rate_per_min + r.llm_rate_per_min + r.tts_rate_per_min, 4
                ),
                "currency": r.currency
            }
            for r in current_rates
        ],
        "markup_settings": {
            "markup_type": markup_settings.markup_type if markup_settings else "percentage",
            "markup_value": markup_settings.markup_value if markup_settings else 20.0,
            "currency": markup_settings.currency if markup_settings else "INR",
            "tax_rate_percent": markup_settings.tax_rate_percent if markup_settings else 18.0
        },
        "usage_metrics": {
            "total_minutes": total_minutes,
            "total_calls": total_calls,
            "total_billed_amount": round(total_billed, 2),
            "total_actual_cost": round(total_actual, 2),
            "active_channels": active_channels,
            "max_channels": 20
        },
        "invoices": invoices,
        "history_count": len(all_versions)
    }


@router.put("/rates")
def update_provider_rates(
    data: RateUpdateModel,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """Updates provider rates by creating a new version."""
    USD_TO_INR = 83.50
    p_name = data.provider.lower().strip()

    if data.total_cost_inr_per_min is not None:
        target_usd = max(0.005, float(data.total_cost_inr_per_min) / USD_TO_INR)
        if p_name == "retell":
            rates = {
                "telephony_rate_per_min": 0.015,
                "stt_rate_per_min": 0.005,
                "llm_rate_per_min": 0.005,
                "tts_rate_per_min": 0.005,
                "platform_rate_per_min": max(0.001, target_usd - 0.030)
            }
        else:
            rates = {
                "telephony_rate_per_min": 0.015,
                "platform_rate_per_min": max(0.001, target_usd - 0.015),
                "stt_rate_per_min": 0.0,
                "llm_rate_per_min": 0.0,
                "tts_rate_per_min": 0.0
            }
    elif data.total_cost_per_min is not None and data.platform_rate_per_min is None:
        target_usd = max(0.005, float(data.total_cost_per_min))
        if p_name == "retell":
            rates = {
                "telephony_rate_per_min": 0.015,
                "stt_rate_per_min": 0.005,
                "llm_rate_per_min": 0.005,
                "tts_rate_per_min": 0.005,
                "platform_rate_per_min": max(0.001, target_usd - 0.030)
            }
        else:
            rates = {
                "telephony_rate_per_min": 0.015,
                "platform_rate_per_min": max(0.001, target_usd - 0.015),
                "stt_rate_per_min": 0.0,
                "llm_rate_per_min": 0.0,
                "tts_rate_per_min": 0.0
            }
    else:
        rates = {
            "platform_rate_per_min": data.platform_rate_per_min if data.platform_rate_per_min is not None else 0.030,
            "telephony_rate_per_min": data.telephony_rate_per_min if data.telephony_rate_per_min is not None else 0.015,
            "stt_rate_per_min": data.stt_rate_per_min if data.stt_rate_per_min is not None else 0.0,
            "llm_rate_per_min": data.llm_rate_per_min if data.llm_rate_per_min is not None else 0.0,
            "tts_rate_per_min": data.tts_rate_per_min if data.tts_rate_per_min is not None else 0.0
        }

    new_v = create_new_rate_version(
        db,
        provider=data.provider,
        rates=rates,
        currency=data.currency
    )
    return {"success": True, "new_version_id": new_v.id, "version_number": new_v.version_number}


@router.put("/markup")
def update_markup_settings(
    data: MarkupSettingsModel,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """Updates school SaaS markup and tax settings."""
    school_id = current_user.get("school_id")
    settings = db.query(SchoolBillingSettings).filter(
        SchoolBillingSettings.school_id == school_id
    ).first()

    if not settings:
        settings = SchoolBillingSettings(school_id=school_id)
        db.add(settings)

    settings.markup_type = data.markup_type
    settings.markup_value = data.markup_value
    settings.currency = data.currency
    settings.tax_rate_percent = data.tax_rate_percent
    db.commit()
    return {"success": True}


@router.get("/school-markups")
def get_school_markups(
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """Lists all schools with their individual markup settings or platform default."""
    schools = db.query(School).order_by(School.name.asc()).all()
    default_settings = db.query(SchoolBillingSettings).filter(SchoolBillingSettings.school_id == None).first()
    
    default_markup = {
        "markup_type": default_settings.markup_type if default_settings else "percentage",
        "markup_value": default_settings.markup_value if default_settings else 20.0,
        "currency": default_settings.currency if default_settings else "INR",
        "tax_rate_percent": default_settings.tax_rate_percent if default_settings else 18.0
    }
    
    result = []
    for s in schools:
        s_settings = db.query(SchoolBillingSettings).filter(SchoolBillingSettings.school_id == s.id).first()
        is_custom = s_settings is not None
        eff_settings = s_settings if is_custom else default_settings
        
        lead_count = db.query(Contact).filter(Contact.school_id == s.id).count()
        
        result.append({
            "school_id": s.id,
            "school_name": s.name,
            "school_slug": s.slug,
            "logo_url": s.logo_url,
            "lead_count": lead_count,
            "is_custom": is_custom,
            "markup_type": eff_settings.markup_type if eff_settings else default_markup["markup_type"],
            "markup_value": eff_settings.markup_value if eff_settings else default_markup["markup_value"],
            "currency": eff_settings.currency if eff_settings else default_markup["currency"],
            "tax_rate_percent": eff_settings.tax_rate_percent if eff_settings else default_markup["tax_rate_percent"],
        })
    return {"default_markup": default_markup, "schools": result}


@router.put("/school-markups/{school_id}")
def update_school_markup(
    school_id: str,
    data: MarkupSettingsModel,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """Sets or updates custom markup for a specific school."""
    school = db.query(School).filter(School.id == school_id).first()
    if not school:
        raise HTTPException(status_code=404, detail="School not found")
        
    settings = db.query(SchoolBillingSettings).filter(SchoolBillingSettings.school_id == school_id).first()
    if not settings:
        settings = SchoolBillingSettings(school_id=school_id)
        db.add(settings)
        
    settings.markup_type = data.markup_type
    settings.markup_value = data.markup_value
    settings.currency = data.currency
    settings.tax_rate_percent = data.tax_rate_percent
    db.commit()
    return {"success": True, "school_id": school_id}


@router.delete("/school-markups/{school_id}")
def reset_school_markup(
    school_id: str,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """Resets a school's markup to the platform default."""
    settings = db.query(SchoolBillingSettings).filter(SchoolBillingSettings.school_id == school_id).first()
    if settings:
        db.delete(settings)
        db.commit()
    return {"success": True, "school_id": school_id, "message": "Reset to platform default"}


class CustomerPricingUpdateModel(BaseModel):
    rate_per_min: float = 15.00
    tax_rate_percent: float = 18.00
    currency: str = "INR"
    school_id: Optional[str] = None


@router.get("/customer-pricing")
def get_customer_pricing(
    school_id: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """Returns active customer rate versions and history (default ₹15.00/min + 18% GST)."""
    target_school = school_id or current_user.get("school_id")
    ensure_default_rate_versions(db)
    
    current_pricing = db.query(CustomerPricingVersion).filter(
        CustomerPricingVersion.school_id == target_school,
        CustomerPricingVersion.is_current == True
    ).first()
    
    if not current_pricing:
        current_pricing = db.query(CustomerPricingVersion).filter(
            CustomerPricingVersion.school_id == None,
            CustomerPricingVersion.is_current == True
        ).first()

    all_versions = db.query(CustomerPricingVersion).filter(
        CustomerPricingVersion.school_id == target_school
    ).order_by(CustomerPricingVersion.version_number.desc()).limit(20).all()

    return {
        "current_pricing": {
            "id": current_pricing.id if current_pricing else None,
            "version_number": current_pricing.version_number if current_pricing else 1,
            "rate_per_min": current_pricing.rate_per_min if current_pricing else 15.00,
            "tax_rate_percent": current_pricing.tax_rate_percent if current_pricing else 18.00,
            "currency": current_pricing.currency if current_pricing else "INR",
            "school_id": target_school
        },
        "history": [
            {
                "id": v.id,
                "version_number": v.version_number,
                "rate_per_min": v.rate_per_min,
                "tax_rate_percent": v.tax_rate_percent,
                "currency": v.currency,
                "is_current": v.is_current,
                "created_at": v.created_at.isoformat() if v.created_at else None
            }
            for v in all_versions
        ]
    }


@router.put("/customer-pricing")
def update_customer_pricing(
    data: CustomerPricingUpdateModel,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """Creates a new customer pricing version."""
    new_v = create_new_customer_pricing_version(
        db,
        rate_per_min=data.rate_per_min,
        tax_rate_percent=data.tax_rate_percent,
        school_id=data.school_id or current_user.get("school_id"),
        currency=data.currency
    )
    return {
        "success": True,
        "version_number": new_v.version_number,
        "rate_per_min": new_v.rate_per_min,
        "tax_rate_percent": new_v.tax_rate_percent,
        "currency": new_v.currency
    }


@router.get("/call-ledger")
def get_call_ledger(
    limit: int = 50,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """Returns itemized call cost ledger with carrier actual cost evidence, customer billed amount, and gross margin."""
    school_id = current_user.get("school_id")
    query = db.query(CallCostSnapshot, CallAttempt, Contact, School)\
        .outerjoin(CallAttempt, CallCostSnapshot.call_attempt_id == CallAttempt.id)\
        .outerjoin(Contact, CallAttempt.contact_id == Contact.id)\
        .outerjoin(School, or_(
            CallCostSnapshot.school_id == School.id,
            CallAttempt.school_id == School.id,
            Contact.school_id == School.id
        ))
        
    if school_id:
        query = query.filter(
            or_(
                CallCostSnapshot.school_id == school_id,
                CallAttempt.school_id == school_id,
                Contact.school_id == school_id
            )
        )
        
    records = query.order_by(CallCostSnapshot.created_at.desc()).limit(limit).all()
    
    result = []
    for snapshot, attempt, contact, school in records:
        duration_sec = snapshot.duration_sec or 0.0
        mins = int(duration_sec // 60)
        secs = int(duration_sec % 60)
        duration_fmt = f"{mins}m {secs}s" if mins > 0 else f"{secs}s"
        
        provider_cost = snapshot.provider_total_cost or 0.0
        markup_amt = snapshot.markup_amount or 0.0
        tax_amt = snapshot.tax_amount or 0.0
        customer_total = snapshot.customer_billable_total or 0.0
        
        markup_cost_pct = getattr(snapshot, 'markup_on_cost_percent', None) or (round((markup_amt / provider_cost * 100.0), 1) if provider_cost > 0 else 0.0)
        gross_margin_pct = getattr(snapshot, 'gross_margin_percent', None) or (round((markup_amt / (customer_total - tax_amt) * 100.0), 1) if (customer_total - tax_amt) > 0 else 0.0)
        
        c_name = contact.name if contact else (snapshot.contact_name or (attempt.contact_name if attempt else None) or "Inbound/Direct Call")
        c_phone = contact.phone_number if contact else (snapshot.contact_phone or (attempt.contact_phone if attempt else None) or "-")
        s_name = school.name if school else (snapshot.school_name or "Platform Default")

        result.append({
            "id": snapshot.id,
            "call_attempt_id": snapshot.call_attempt_id,
            "provider": snapshot.provider,
            "provider_call_id": getattr(snapshot, 'provider_call_id', None) or (attempt.provider_call_id if attempt else None),
            "created_at": snapshot.created_at.isoformat() if snapshot.created_at else None,
            "formatted_date": snapshot.created_at.strftime("%d %b, %H:%M") if snapshot.created_at else "",
            "contact_name": c_name,
            "contact_phone": c_phone,
            "school_name": s_name,
            "duration_sec": duration_sec,
            "duration_formatted": duration_fmt,
            "provider_platform_cost": snapshot.provider_platform_cost,
            "provider_telephony_cost": snapshot.provider_telephony_cost,
            "provider_ai_cost": snapshot.provider_ai_cost,
            "provider_total_cost": provider_cost,
            "cost_source": getattr(snapshot, 'cost_source', 'rate_card') or 'rate_card',
            "provider_usage_id": getattr(snapshot, 'provider_usage_id', None),
            "provider_invoice_id": getattr(snapshot, 'provider_invoice_id', None),
            "provider_rate_version_id": getattr(snapshot, 'provider_rate_version_id', snapshot.rate_version_id),
            "customer_rate_version_id": getattr(snapshot, 'customer_rate_version_id', None),
            "customer_rate_per_min": getattr(snapshot, 'customer_rate_per_min', 15.0) or 15.0,
            "markup_amount": markup_amt,
            "markup_on_cost_percent": markup_cost_pct,
            "gross_margin_percent": gross_margin_pct,
            "tax_amount": tax_amt,
            "customer_billable_total": customer_total,
            "currency": snapshot.currency or "INR"
        })
        
    return result


@router.put("/call-ledger/{snapshot_id}")
def update_call_cost_snapshot(
    snapshot_id: str,
    data: CallCostUpdateModel,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """Allows manual adjustment of carrier wholesale cost and customer billable amount for a specific call record."""
    snapshot = db.query(CallCostSnapshot).filter(CallCostSnapshot.id == snapshot_id).first()
    if not snapshot:
        raise HTTPException(status_code=404, detail="Call cost record not found")

    if data.provider_total_cost is not None:
        snapshot.provider_total_cost = float(data.provider_total_cost)

    if data.customer_billable_total is not None:
        snapshot.customer_billable_total = float(data.customer_billable_total)

    # Recalculate margins
    cost = snapshot.provider_total_cost or 0.0
    tax = snapshot.tax_amount or 0.0
    billed = snapshot.customer_billable_total or 0.0
    net_sales = max(0.0, billed - tax)

    snapshot.markup_amount = max(0.0, net_sales - cost)
    snapshot.gross_margin_percent = round((snapshot.markup_amount / net_sales * 100.0), 1) if net_sales > 0 else 0.0
    snapshot.markup_on_cost_percent = round((snapshot.markup_amount / cost * 100.0), 1) if cost > 0 else 0.0
    snapshot.cost_source = "manual_adjustment"

    db.commit()
    db.refresh(snapshot)
    return {
        "success": True,
        "id": snapshot.id,
        "provider_total_cost": snapshot.provider_total_cost,
        "customer_billable_total": snapshot.customer_billable_total,
        "markup_amount": snapshot.markup_amount,
        "gross_margin_percent": snapshot.gross_margin_percent,
        "cost_source": snapshot.cost_source
    }


@router.get("/economics")
def get_provider_economics(
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """
    Returns comparative profitability analytics across voice engines (Retell, OmniDimension, Bolna).
    Allows Platform Admin to see which provider yields the highest margin per minute.
    """
    from sqlalchemy import func
    from src.db import CallCostSnapshot, CallAttempt, BillingRateVersion, CustomerPricingVersion
    
    providers_meta = [
        {"id": "retell", "name": "Retell AI", "default_cost_usd": 0.080, "desc": "Neural Voice (Platform + Carrier + STT + LLM + TTS)"},
        {"id": "omnidimension", "name": "OmniDimension AI", "default_cost_usd": 0.067, "desc": "Smart Concurrency Engine (Bundled AI + Carrier)"},
        {"id": "bolna", "name": "Bolna AI", "default_cost_usd": 0.060, "desc": "Regional Optimized Voice Engine"}
    ]
    
    USD_TO_INR = 83.50
    STANDARD_CLIENT_RATE = 15.00

    # Query active customer selling rate
    curr_customer_pricing = db.query(CustomerPricingVersion).filter(
        CustomerPricingVersion.is_current == True
    ).first()
    client_selling_rate = curr_customer_pricing.rate_per_min if (curr_customer_pricing and curr_customer_pricing.rate_per_min > 0) else STANDARD_CLIENT_RATE
    
    economics_list = []
    total_calls_all = 0
    total_minutes_all = 0.0
    total_revenue_all = 0.0
    total_cost_all = 0.0
    total_profit_all = 0.0
    
    for p in providers_meta:
        pid = p["id"]

        # Query active rate version for this provider
        rate_v = db.query(BillingRateVersion).filter(
            BillingRateVersion.provider == pid,
            BillingRateVersion.is_current == True
        ).first()

        if rate_v:
            total_usd = (rate_v.platform_rate_per_min or 0.0) + (rate_v.telephony_rate_per_min or 0.0) + (rate_v.stt_rate_per_min or 0.0) + (rate_v.llm_rate_per_min or 0.0) + (rate_v.tts_rate_per_min or 0.0)
            active_cost_inr = round(total_usd * USD_TO_INR, 2) if total_usd > 0 else round(p["default_cost_usd"] * USD_TO_INR, 2)
        else:
            active_cost_inr = round(p["default_cost_usd"] * USD_TO_INR, 2)

        # Query actual snapshots for this provider
        snaps = db.query(CallCostSnapshot).filter(CallCostSnapshot.provider == pid).all()
        
        calls = len(snaps)
        duration_sec = sum((s.duration_sec or 0.0) for s in snaps)
        minutes = round(duration_sec / 60.0, 1)
        cost = sum((s.provider_total_cost or 0.0) for s in snaps)
        revenue_pre_tax = sum(((s.customer_billable_total or 0.0) - (s.tax_amount or 0.0)) for s in snaps)
        
        # If real records exist, use real data; otherwise provide active configured metrics
        if minutes > 0:
            avg_cost_min = round(cost / minutes, 2)
            avg_rev_min = round(revenue_pre_tax / minutes, 2)
        else:
            avg_cost_min = active_cost_inr
            avg_rev_min = client_selling_rate
            cost = round(minutes * avg_cost_min, 2)
            revenue_pre_tax = round(minutes * avg_rev_min, 2)
            
        profit = round(revenue_pre_tax - cost, 2)
        profit_per_min = round(avg_rev_min - avg_cost_min, 2)
        gross_margin_pct = round((profit_per_min / avg_rev_min * 100.0), 1) if avg_rev_min > 0 else 0.0
        markup_on_cost_pct = round((profit_per_min / avg_cost_min * 100.0), 1) if avg_cost_min > 0 else 0.0
        
        total_calls_all += calls
        total_minutes_all += minutes
        total_revenue_all += revenue_pre_tax
        total_cost_all += cost
        total_profit_all += profit
        
        economics_list.append({
            "provider": pid,
            "provider_name": p["name"],
            "description": p["desc"],
            "calls": calls,
            "minutes": minutes,
            "total_revenue": revenue_pre_tax,
            "total_cost": cost,
            "total_profit": profit,
            "cost_per_min": avg_cost_min,
            "revenue_per_min": avg_rev_min,
            "profit_per_min": profit_per_min,
            "gross_margin_percent": gross_margin_pct,
            "markup_on_cost_percent": markup_on_cost_pct,
            "currency": "INR"
        })
        
    avg_total_cost_min = round(total_cost_all / total_minutes_all, 2) if total_minutes_all > 0 else round(0.080 * USD_TO_INR, 2)
    avg_total_rev_min = round(total_revenue_all / total_minutes_all, 2) if total_minutes_all > 0 else STANDARD_CLIENT_RATE
    avg_total_profit_min = round(avg_total_rev_min - avg_total_cost_min, 2)
    overall_gross_margin = round((avg_total_profit_min / avg_total_rev_min * 100.0), 1) if avg_total_rev_min > 0 else 55.5
    
    return {
        "providers": economics_list,
        "summary": {
            "total_calls": total_calls_all,
            "total_minutes": round(total_minutes_all, 1),
            "total_revenue": round(total_revenue_all, 2),
            "total_cost": round(total_cost_all, 2),
            "total_profit": round(total_profit_all, 2),
            "cost_per_min": avg_total_cost_min,
            "revenue_per_min": avg_total_rev_min,
            "profit_per_min": avg_total_profit_min,
            "gross_margin_percent": overall_gross_margin
        }
    }



# ── Operational Activity & Webhook Logs ──────────────────────────────

@router.get("/logs")
def get_operational_logs(
    provider: Optional[str] = None,
    status: Optional[str] = None,
    search: Optional[str] = None,
    limit: int = 50,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """Queries webhook and call events for real-time operational debugging."""
    query = db.query(ProviderWebhookEvent)
    if provider and provider != "all":
        query = query.filter(ProviderWebhookEvent.provider == provider.lower())
    if status and status != "all":
        query = query.filter(ProviderWebhookEvent.processing_status == status.lower())
    if search:
        query = query.filter(
            (ProviderWebhookEvent.provider_call_id.ilike(f"%{search}%")) |
            (ProviderWebhookEvent.event_type.ilike(f"%{search}%")) |
            (ProviderWebhookEvent.payload_json.ilike(f"%{search}%"))
        )

    logs = query.order_by(ProviderWebhookEvent.received_at.desc()).limit(limit).all()

    return [
        {
            "id": log.id,
            "provider": log.provider,
            "event_type": log.event_type,
            "provider_event_id": log.provider_event_id,
            "provider_call_id": log.provider_call_id,
            "signature_verified": log.signature_verified,
            "received_at": log.received_at.isoformat() if log.received_at else None,
            "processing_status": log.processing_status,
            "payload": json.loads(log.payload_json) if log.payload_json else {},
            "error_message": log.error_message
        }
        for log in logs
    ]


# ── Competitor Comparison & School USPs ──────────────────────────────

@router.get("/comparisons")
def list_competitor_comparisons(
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """Lists configured competitor battlecards and USPs for the school."""
    school_id = current_user.get("school_id")
    query = db.query(CompetitorComparison)
    if school_id:
        query = query.filter(CompetitorComparison.school_id == school_id)
    return query.order_by(CompetitorComparison.created_at.desc()).all()


@router.post("/comparisons")
def create_competitor_comparison(
    data: CompetitorCreateModel,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """Creates a new competitor battlecard with advantages and scripts."""
    school_id = current_user.get("school_id")
    comp = CompetitorComparison(
        school_id=school_id,
        competitor_name=data.competitor_name,
        key_advantages=data.key_advantages,
        curriculum_comparison=data.curriculum_comparison,
        ratio_comparison=data.ratio_comparison,
        facilities_comparison=data.facilities_comparison,
        objection_scripts=data.objection_scripts
    )
    db.add(comp)
    db.commit()
    db.refresh(comp)
    return comp


@router.delete("/comparisons/{comp_id}")
def delete_competitor_comparison(
    comp_id: str,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """Deletes a competitor comparison."""
    comp = db.query(CompetitorComparison).filter(CompetitorComparison.id == comp_id).first()
    if comp:
        db.delete(comp)
        db.commit()
    return {"success": True}
