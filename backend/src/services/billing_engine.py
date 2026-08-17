"""
Dual-Layer Billing Engine.
Decouples actual provider costs from customer SaaS pricing with rate versioning,
Decimal precision, and immutable snapshots across Retell, OmniDimension, and Bolna.
"""

import json
from decimal import Decimal, ROUND_HALF_UP
from typing import Dict, Any, Optional, Union
from datetime import datetime
from sqlalchemy.orm import Session
from src.db import (
    SessionLocal,
    BillingRateVersion,
    CustomerPricingVersion,
    SchoolBillingSettings,
    CallCostSnapshot,
    Contact,
    CallAttempt,
    School
)

# Standard Financial Constants
USD_TO_INR_DEFAULT = Decimal("83.50")
STANDARD_CUSTOMER_RATE_INR = Decimal("15.00") # ₹15.00/min
STANDARD_GST_RATE_PERCENT = Decimal("18.00")   # 18% GST

DEFAULT_PROVIDER_RATES = {
    "retell": {
        "platform_rate": Decimal("0.030"),
        "telephony_rate": Decimal("0.015"),
        "stt_rate": Decimal("0.005"),
        "llm_rate": Decimal("0.020"),
        "tts_rate": Decimal("0.010"),
        "currency": "USD"
    },
    "omnidimension": {
        "platform_rate": Decimal("0.025"),
        "telephony_rate": Decimal("0.012"),
        "stt_rate": Decimal("0.004"),
        "llm_rate": Decimal("0.018"),
        "tts_rate": Decimal("0.008"),
        "currency": "USD"
    },
    "bolna": {
        "platform_rate": Decimal("0.022"),
        "telephony_rate": Decimal("0.010"),
        "stt_rate": Decimal("0.004"),
        "llm_rate": Decimal("0.016"),
        "tts_rate": Decimal("0.008"),
        "currency": "USD"
    }
}


def to_decimal(val: Any, decimals: int = 4) -> Decimal:
    """Converts a number/string to Decimal quantized to specified precision."""
    if val is None:
        val = 0
    d = Decimal(str(val))
    if decimals > 0:
        q = Decimal("1." + "0" * decimals)
        return d.quantize(q, rounding=ROUND_HALF_UP)
    return d.quantize(Decimal("1"), rounding=ROUND_HALF_UP)


def ensure_default_rate_versions(db: Session):
    """Seeds initial provider and customer rate versions if none exist."""
    # 1. Provider Cost Rate Versions
    for provider, rates in DEFAULT_PROVIDER_RATES.items():
        existing = db.query(BillingRateVersion).filter(
            BillingRateVersion.provider == provider,
            BillingRateVersion.is_current == True
        ).first()
        if not existing:
            rate_v = BillingRateVersion(
                version_number=1,
                provider=provider,
                platform_rate_per_min=float(rates["platform_rate"]),
                telephony_rate_per_min=float(rates["telephony_rate"]),
                stt_rate_per_min=float(rates["stt_rate"]),
                llm_rate_per_min=float(rates["llm_rate"]),
                tts_rate_per_min=float(rates["tts_rate"]),
                currency=rates["currency"],
                is_current=True
            )
            db.add(rate_v)

    # 2. Customer Pricing Rate Version (Standard ₹15.00/min + 18% GST)
    existing_cust = db.query(CustomerPricingVersion).filter(
        CustomerPricingVersion.school_id == None,
        CustomerPricingVersion.is_current == True
    ).first()
    if not existing_cust:
        cust_v = CustomerPricingVersion(
            version_number=1,
            school_id=None,
            rate_per_min=float(STANDARD_CUSTOMER_RATE_INR),
            tax_rate_percent=float(STANDARD_GST_RATE_PERCENT),
            currency="INR",
            is_current=True
        )
        db.add(cust_v)

    db.commit()


def calculate_and_freeze_cost_snapshot(
    db: Session,
    call_attempt_id: str,
    provider: str,
    duration_sec: Union[float, Decimal],
    provider_call_id: Optional[str] = None,
    school_id: Optional[str] = None,
    actual_provider_cost_usd: Optional[Union[float, Decimal]] = None,
    provider_usage_id: Optional[str] = None,
    provider_invoice_id: Optional[str] = None,
    cost_breakdown_metadata: Optional[Dict[str, Any]] = None
) -> CallCostSnapshot:
    """
    Computes provider actual cost and client billable price (₹15.00/min default) using Decimal arithmetic,
    and freezes an immutable CallCostSnapshot linked to both rate versions.
    """
    p_name = (provider or "retell").lower().strip()
    ensure_default_rate_versions(db)

    # Idempotent check: if a snapshot already exists for this call attempt, return it
    existing_snap = db.query(CallCostSnapshot).filter(
        CallCostSnapshot.call_attempt_id == call_attempt_id
    ).first()
    if existing_snap:
        return existing_snap

    # 1. Fetch current provider rate version
    provider_rate_v = db.query(BillingRateVersion).filter(
        BillingRateVersion.provider == p_name,
        BillingRateVersion.is_current == True
    ).first()
    if not provider_rate_v:
        provider_rate_v = db.query(BillingRateVersion).filter(
            BillingRateVersion.is_current == True
        ).first()

    # 2. Fetch current customer pricing version
    customer_rate_v = None
    if school_id:
        customer_rate_v = db.query(CustomerPricingVersion).filter(
            CustomerPricingVersion.school_id == school_id,
            CustomerPricingVersion.is_current == True
        ).first()
    if not customer_rate_v:
        customer_rate_v = db.query(CustomerPricingVersion).filter(
            CustomerPricingVersion.school_id == None,
            CustomerPricingVersion.is_current == True
        ).first()

    # 3. Fetch school billing settings for custom overrides
    settings = None
    if school_id:
        settings = db.query(SchoolBillingSettings).filter(
            SchoolBillingSettings.school_id == school_id
        ).first()
    if not settings:
        settings = db.query(SchoolBillingSettings).filter(
            SchoolBillingSettings.school_id == None
        ).first()

    currency = settings.currency if settings else "INR"
    conversion_rate = USD_TO_INR_DEFAULT if currency == "INR" else Decimal("1.0")
    tax_rate = Decimal(str(settings.tax_rate_percent if settings else (customer_rate_v.tax_rate_percent if customer_rate_v else 18.0)))

    # Duration in decimal minutes
    dur_sec_dec = max(Decimal(str(duration_sec or 0.0)), Decimal("0.0"))
    duration_min = dur_sec_dec / Decimal("60.0")

    # 4. Determine Provider Base Cost (prefer actual provider evidence if present)
    cost_source = "rate_card"
    if actual_provider_cost_usd is not None and Decimal(str(actual_provider_cost_usd)) > Decimal("0.0"):
        cost_source = "provider_actual"
        provider_total_usd = Decimal(str(actual_provider_cost_usd))
        # Itemize if breakdown not split
        platform_cost_usd = provider_total_usd * Decimal("0.40")
        telephony_cost_usd = provider_total_usd * Decimal("0.20")
        ai_cost_usd = provider_total_usd * Decimal("0.40")
    else:
        # Fallback to configured rate card
        p_rate = Decimal(str(provider_rate_v.platform_rate_per_min if provider_rate_v else "0.030"))
        t_rate = Decimal(str(provider_rate_v.telephony_rate_per_min if provider_rate_v else "0.015"))
        stt_r = Decimal(str(provider_rate_v.stt_rate_per_min if provider_rate_v else "0.005"))
        llm_r = Decimal(str(provider_rate_v.llm_rate_per_min if provider_rate_v else "0.020"))
        tts_r = Decimal(str(provider_rate_v.tts_rate_per_min if provider_rate_v else "0.010"))

        platform_cost_usd = duration_min * p_rate
        telephony_cost_usd = duration_min * t_rate
        ai_cost_usd = duration_min * (stt_r + llm_r + tts_r)
        provider_total_usd = platform_cost_usd + telephony_cost_usd + ai_cost_usd

    # Convert provider costs to target currency (INR)
    platform_cost = platform_cost_usd * conversion_rate
    telephony_cost = telephony_cost_usd * conversion_rate
    ai_cost = ai_cost_usd * conversion_rate
    provider_total = provider_total_usd * conversion_rate

    # 5. Customer Commercial Rate Calculation (Standard ₹15.00 / min)
    # Switching provider (Retell -> OmniDimension -> Bolna) changes internal cost, profit, and margin,
    # but does NOT change customer rate (₹15.00/min).
    customer_rate_per_min = Decimal(str(customer_rate_v.rate_per_min if customer_rate_v else STANDARD_CUSTOMER_RATE_INR))

    if settings and settings.markup_type == "percentage" and settings.markup_value:
        base_per_min = (provider_total / duration_min) if duration_min > 0 else Decimal("6.68")
        customer_rate_per_min = base_per_min * (Decimal("1.0") + (Decimal(str(settings.markup_value)) / Decimal("100.0")))
    elif settings and settings.markup_type == "fixed_per_min" and settings.markup_value:
        customer_rate_per_min = Decimal(str(settings.markup_value))

    pre_tax_customer_subtotal = duration_min * customer_rate_per_min
    markup_amount = max(Decimal("0.0"), pre_tax_customer_subtotal - provider_total)
    tax_amount = pre_tax_customer_subtotal * (tax_rate / Decimal("100.0"))
    customer_billable_total = pre_tax_customer_subtotal + tax_amount

    # Profitability and Margins
    markup_on_cost_percent = (markup_amount / provider_total * Decimal("100.0")) if provider_total > Decimal("0.0") else Decimal("0.0")
    gross_margin_percent = (markup_amount / pre_tax_customer_subtotal * Decimal("100.0")) if pre_tax_customer_subtotal > Decimal("0.0") else Decimal("0.0")

    breakdown_json = json.dumps(cost_breakdown_metadata) if cost_breakdown_metadata else None

    # Fetch CallAttempt to populate contact and school metadata snapshot
    attempt = db.query(CallAttempt).filter(CallAttempt.id == call_attempt_id).first() if call_attempt_id else None
    contact = db.query(Contact).filter(Contact.id == attempt.contact_id).first() if (attempt and attempt.contact_id) else None
    c_name = contact.name if contact else (attempt.contact_name if attempt else None)
    c_phone = contact.phone_number if contact else (attempt.contact_phone if attempt else None)
    effective_school_id = school_id or (contact.school_id if contact else None) or (attempt.school_id if attempt else None)
    school_obj = db.query(School).filter(School.id == effective_school_id).first() if effective_school_id else None
    s_name = school_obj.name if school_obj else None

    if attempt:
        if not attempt.school_id and effective_school_id:
            attempt.school_id = effective_school_id
        if not attempt.contact_name and c_name:
            attempt.contact_name = c_name
        if not attempt.contact_phone and c_phone:
            attempt.contact_phone = c_phone

    # 6. Create immutable CallCostSnapshot
    snapshot = CallCostSnapshot(
        call_attempt_id=call_attempt_id,
        school_id=effective_school_id,
        school_name=s_name,
        contact_name=c_name,
        contact_phone=c_phone,
        provider=p_name,
        provider_call_id=provider_call_id,
        retell_call_id=provider_call_id,
        provider_rate_version_id=provider_rate_v.id if provider_rate_v else None,
        rate_version_id=provider_rate_v.id if provider_rate_v else None,
        customer_rate_version_id=customer_rate_v.id if customer_rate_v else None,
        duration_sec=float(to_decimal(dur_sec_dec, 2)),
        provider_platform_cost=float(to_decimal(platform_cost, 4)),
        provider_telephony_cost=float(to_decimal(telephony_cost, 4)),
        provider_ai_cost=float(to_decimal(ai_cost, 4)),
        provider_total_cost=float(to_decimal(provider_total, 4)),
        cost_source=cost_source,
        provider_usage_id=provider_usage_id,
        provider_invoice_id=provider_invoice_id,
        provider_cost_breakdown_json=breakdown_json,
        customer_rate_per_min=float(to_decimal(customer_rate_per_min, 2)),
        markup_amount=float(to_decimal(markup_amount, 4)),
        markup_on_cost_percent=float(to_decimal(markup_on_cost_percent, 2)),
        gross_margin_percent=float(to_decimal(gross_margin_percent, 2)),
        tax_amount=float(to_decimal(tax_amount, 4)),
        customer_billable_total=float(to_decimal(customer_billable_total, 4)),
        currency=currency
    )
    db.add(snapshot)
    db.commit()
    db.refresh(snapshot)
    return snapshot


def create_new_rate_version(
    db: Session,
    provider: str,
    rates: Dict[str, Any],
    currency: str = "USD"
) -> BillingRateVersion:
    """Creates a new provider rate card version and retires previous active version."""
    p_name = provider.lower().strip()
    last_v = db.query(BillingRateVersion).filter(
        BillingRateVersion.provider == p_name
    ).order_by(BillingRateVersion.version_number.desc()).first()

    next_ver = (last_v.version_number + 1) if last_v else 1

    db.query(BillingRateVersion).filter(
        BillingRateVersion.provider == p_name
    ).update({"is_current": False})

    new_v = BillingRateVersion(
        version_number=next_ver,
        provider=p_name,
        platform_rate_per_min=float(to_decimal(rates.get("platform_rate_per_min", 0.030), 4)),
        telephony_rate_per_min=float(to_decimal(rates.get("telephony_rate_per_min", 0.015), 4)),
        stt_rate_per_min=float(to_decimal(rates.get("stt_rate_per_min", 0.005), 4)),
        llm_rate_per_min=float(to_decimal(rates.get("llm_rate_per_min", 0.020), 4)),
        tts_rate_per_min=float(to_decimal(rates.get("tts_rate_per_min", 0.010), 4)),
        currency=currency,
        is_current=True
    )
    db.add(new_v)
    db.commit()
    db.refresh(new_v)
    return new_v


def create_new_customer_pricing_version(
    db: Session,
    rate_per_min: Union[float, Decimal] = STANDARD_CUSTOMER_RATE_INR,
    tax_rate_percent: Union[float, Decimal] = STANDARD_GST_RATE_PERCENT,
    school_id: Optional[str] = None,
    currency: str = "INR"
) -> CustomerPricingVersion:
    """Creates a new customer pricing version and retires previous active version."""
    last_v = db.query(CustomerPricingVersion).filter(
        CustomerPricingVersion.school_id == school_id
    ).order_by(CustomerPricingVersion.version_number.desc()).first()

    next_ver = (last_v.version_number + 1) if last_v else 1

    db.query(CustomerPricingVersion).filter(
        CustomerPricingVersion.school_id == school_id
    ).update({"is_current": False})

    new_cust = CustomerPricingVersion(
        version_number=next_ver,
        school_id=school_id,
        rate_per_min=float(to_decimal(rate_per_min, 2)),
        tax_rate_percent=float(to_decimal(tax_rate_percent, 2)),
        currency=currency,
        is_current=True
    )
    db.add(new_cust)
    db.commit()
    db.refresh(new_cust)
    return new_cust
