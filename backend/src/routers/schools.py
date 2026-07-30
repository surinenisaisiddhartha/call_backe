"""
Platform-admin tenant management: onboard schools, list them, update, remove.

Onboarding a school does three things:
  1. Creates the schools row (tenant identity + branding fields).
  2. Provisions the school's OWN Retell agent + LLM from the shared prompt
     template with the school's name/location/phone substituted (best-effort:
     a Retell hiccup doesn't block onboarding; the agent can be re-provisioned
     later via POST /api/schools/{id}/provision-agent).
  3. Creates the school's Cognito login (if Cognito is configured) bound to
     the tenant via custom:school_id, returning the temporary password ONCE
     for the admin to hand to the school.
"""
import os
import re
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from src.db import get_db, School, Contact, Settings
from src.routers.auth import require_admin

router = APIRouter(prefix="/api/schools", tags=["Schools"])


def _slugify(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", (name or "").lower()).strip("-")
    return slug or "school"


def _get_setting(db: Session, key: str, env_key: str = None) -> str:
    s = db.query(Settings).filter(Settings.key == key).first()
    return (s.value if s else None) or os.getenv(env_key or key.upper(), "")


def _serialize(db: Session, school: School) -> dict:
    contact_count = db.query(Contact).filter(Contact.school_id == school.id).count()
    return {
        "id": school.id,
        "name": school.name,
        "slug": school.slug,
        "location": school.location,
        "contact_phone": school.contact_phone,
        "website": school.website,
        "admin_email": school.admin_email,
        "retell_agent_id": school.retell_agent_id,
        "status": school.status,
        "contact_count": contact_count,
        "created_at": school.created_at.isoformat() if school.created_at else None,
    }


def _provision_agent(db: Session, school: School) -> str:
    """Best-effort agent provisioning. Returns '' on success, error text on failure."""
    try:
        from src.school_agent import provision_school_agent
        api_key = _get_setting(db, "retell_api_key", "RETELL_API_KEY")
        base_url = os.getenv("WEBHOOK_BASE_URL", "")
        secret = _get_setting(db, "aegis_tools_secret", "AEGIS_TOOLS_SECRET")
        if not api_key or not base_url:
            return "RETELL_API_KEY or WEBHOOK_BASE_URL not configured"
        result = provision_school_agent(school, api_key, base_url, secret)
        school.retell_agent_id = result["agent_id"]
        school.retell_llm_id = result["llm_id"]
        db.commit()
        return ""
    except Exception as e:
        print(f"[SCHOOLS] Agent provisioning failed for '{school.name}': {e}")
        return str(e)


@router.get("")
def list_schools(db: Session = Depends(get_db), _admin: dict = Depends(require_admin)):
    schools = db.query(School).order_by(School.created_at.asc()).all()
    return [_serialize(db, s) for s in schools]


@router.post("")
def create_school(payload: dict, db: Session = Depends(get_db), _admin: dict = Depends(require_admin)):
    name = (payload.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="School name is required")

    slug = _slugify(name)
    if db.query(School).filter(School.slug == slug).first():
        raise HTTPException(status_code=400, detail=f"A school with the slug '{slug}' already exists")

    admin_email = (payload.get("admin_email") or "").strip().lower() or None

    school = School(
        name=name,
        slug=slug,
        location=(payload.get("location") or "").strip() or None,
        contact_phone=(payload.get("contact_phone") or "").strip() or None,
        website=(payload.get("website") or "").strip() or None,
        admin_email=admin_email,
    )
    db.add(school)
    db.commit()
    db.refresh(school)

    agent_error = _provision_agent(db, school)

    temp_password = None
    cognito_error = None
    from src import cognito
    if admin_email:
        if cognito.cognito_enabled():
            try:
                temp_password = cognito.create_school_user(admin_email, school.id)
            except Exception as e:
                cognito_error = str(e)
                print(f"[SCHOOLS] Cognito user creation failed for {admin_email}: {e}")
        else:
            cognito_error = "Cognito is not configured (COGNITO_* env vars missing) — no login was created"

    return {
        "school": _serialize(db, school),
        "temp_password": temp_password,   # shown ONCE — not stored anywhere
        "agent_error": agent_error or None,
        "cognito_error": cognito_error,
    }


@router.post("/{school_id}/provision-agent")
def reprovision_agent(school_id: str, db: Session = Depends(get_db), _admin: dict = Depends(require_admin)):
    """Retry/refresh this school's Retell agent (e.g. after a failed onboard or a prompt template update)."""
    school = db.query(School).filter(School.id == school_id).first()
    if not school:
        raise HTTPException(status_code=404, detail="School not found")
    err = _provision_agent(db, school)
    if err:
        raise HTTPException(status_code=502, detail=f"Agent provisioning failed: {err}")
    return {"success": True, "agent_id": school.retell_agent_id}


@router.post("/{school_id}/reset-password")
def reset_school_password(school_id: str, db: Session = Depends(get_db), _admin: dict = Depends(require_admin)):
    """Issue a fresh temporary password for the school's login (delete + recreate the Cognito user)."""
    from src import cognito
    if not cognito.cognito_enabled():
        raise HTTPException(status_code=400, detail="Cognito is not configured")
    school = db.query(School).filter(School.id == school_id).first()
    if not school or not school.admin_email:
        raise HTTPException(status_code=404, detail="School (or its admin email) not found")
    cognito.delete_school_user(school.admin_email)
    try:
        temp_password = cognito.create_school_user(school.admin_email, school.id)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Could not recreate the login: {e}")
    return {"temp_password": temp_password}


@router.post("/{school_id}/view-as")
def view_as_school(school_id: str, db: Session = Depends(get_db), admin: dict = Depends(require_admin)):
    """
    Mints a short-lived token scoped to this school so the platform admin can
    see exactly what that school's dashboard shows — useful for support, and
    the only way to preview a school's view before Cognito logins exist.
    The token is marked `impersonated` so the UI can badge it and offer an exit.
    """
    from datetime import timedelta
    from src.routers.auth import create_access_token

    school = db.query(School).filter(School.id == school_id).first()
    if not school:
        raise HTTPException(status_code=404, detail="School not found")

    token = create_access_token(
        data={
            "sub": admin.get("email"),
            "email": admin.get("email"),
            "role": "school",
            "school_id": school.id,
            "impersonated": True,
        },
        expires_delta=timedelta(hours=2),
    )
    return {
        "token": token,
        "user": {
            "email": admin.get("email"),
            "role": "school",
            "school_id": school.id,
            "school_name": school.name,
            "impersonated": True,
        },
    }


@router.patch("/{school_id}")
def update_school(school_id: str, payload: dict, db: Session = Depends(get_db), _admin: dict = Depends(require_admin)):
    school = db.query(School).filter(School.id == school_id).first()
    if not school:
        raise HTTPException(status_code=404, detail="School not found")

    identity_changed = False
    for field in ("name", "location", "contact_phone", "website", "status"):
        if field in payload and payload[field] is not None:
            value = (str(payload[field]) or "").strip()
            if getattr(school, field) != value:
                setattr(school, field, value)
                if field in ("name", "location", "contact_phone"):
                    identity_changed = True
    db.commit()

    agent_error = None
    if identity_changed and school.retell_agent_id:
        agent_error = _provision_agent(db, school) or None

    return {"school": _serialize(db, school), "agent_error": agent_error}


@router.delete("/{school_id}")
def delete_school(school_id: str, db: Session = Depends(get_db), _admin: dict = Depends(require_admin)):
    school = db.query(School).filter(School.id == school_id).first()
    if not school:
        raise HTTPException(status_code=404, detail="School not found")

    contact_count = db.query(Contact).filter(Contact.school_id == school.id).count()
    if contact_count > 0:
        raise HTTPException(
            status_code=400,
            detail=f"This school still has {contact_count} contacts. Delete or reassign its data first."
        )

    from src import cognito
    if school.admin_email and cognito.cognito_enabled():
        cognito.delete_school_user(school.admin_email)

    db.delete(school)
    db.commit()
    return {"success": True}


# ── Per-school settings (calendar, Cal.com, SMTP, phone number) ──────────
# All optional: a school without these configured falls back to the shared
# platform config (src/school_settings.py) — this only lets an admin give a
# specific school its OWN calendar/Cal.com account/email sender/caller ID.

_SCHOOL_SETTING_FIELDS = [
    "retell_phone_number",
    "google_calendar_credentials_json",
    "google_calendar_id",
    "cal_com_api_key",
    "cal_com_event_link",
    "smtp_server",
    "smtp_port",
    "smtp_username",
    "smtp_password",
    "smtp_from_email",
]

_SECRET_FIELDS = {"google_calendar_credentials_json", "cal_com_api_key", "smtp_password"}

_SECRET_MASK = "••••••••••••••••"


@router.get("/{school_id}/settings")
def get_school_settings(school_id: str, db: Session = Depends(get_db), _admin: dict = Depends(require_admin)):
    school = db.query(School).filter(School.id == school_id).first()
    if not school:
        raise HTTPException(status_code=404, detail="School not found")

    result = {}
    for field in _SCHOOL_SETTING_FIELDS:
        value = getattr(school, field)
        if value and field in _SECRET_FIELDS:
            result[field] = _SECRET_MASK
        else:
            result[field] = value
    return result


@router.patch("/{school_id}/settings")
def update_school_settings(school_id: str, updates: dict, db: Session = Depends(get_db), _admin: dict = Depends(require_admin)):
    school = db.query(School).filter(School.id == school_id).first()
    if not school:
        raise HTTPException(status_code=404, detail="School not found")

    for field, value in updates.items():
        if field not in _SCHOOL_SETTING_FIELDS:
            continue
        if value == _SECRET_MASK:
            continue  # Unchanged secret — the frontend echoes the mask back
        if value == "":
            value = None
        if field == "smtp_port" and value is not None:
            try:
                value = int(value)
            except (TypeError, ValueError):
                raise HTTPException(status_code=400, detail="smtp_port must be a number")
        setattr(school, field, value)

    db.commit()
    return {"success": True}
