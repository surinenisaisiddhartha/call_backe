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
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
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
        "logo_url": school.logo_url,
        "admin_email": school.admin_email,
        "retell_agent_id": school.retell_agent_id,
        "status": school.status,
        "contact_count": contact_count,
        "created_at": school.created_at.isoformat() if school.created_at else None,
    }


def _provision_agent(db: Session, school: School) -> str:
    """Best-effort agent provisioning via active provider adapter. Returns '' on success, error text on failure."""
    try:
        from src.services.admission_agent_service import admission_agent_service
        res = admission_agent_service.provision_school_agent(school.id)
        if res.get("success"):
            return ""
        return res.get("error", "Agent provisioning failed")
    except Exception as e:
        print(f"[SCHOOLS] Agent provisioning failed for {school.name}: {e}")
        return str(e)


@router.get("")
def list_schools(db: Session = Depends(get_db), _admin: dict = Depends(require_admin)):
    schools = db.query(School).order_by(School.created_at.asc()).all()
    return [_serialize(db, s) for s in schools]


@router.post("")
def create_school(
    payload: dict,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    _admin: dict = Depends(require_admin),
):
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

    # Build this school's own knowledge base from its own website, in the
    # background — scraping a dozen pages takes far too long to hold the
    # onboarding request open. Without it the school's agent has nothing to
    # ground answers in and says "I don't have that information" to everything.
    knowledge_status = "not started — no website provided"
    if school.website:
        from src.knowledge import refresh_knowledge_base
        background_tasks.add_task(refresh_knowledge_base, school.id)
        knowledge_status = f"scraping {school.website} in the background"

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
        "knowledge_status": knowledge_status,
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


from fastapi import UploadFile, File
import boto3
import os

@router.post("/{school_id}/logo")
def upload_school_logo(
    school_id: str, 
    file: UploadFile = File(...), 
    db: Session = Depends(get_db), 
    _admin: dict = Depends(require_admin)
):
    school = db.query(School).filter(School.id == school_id).first()
    if not school:
        raise HTTPException(status_code=404, detail="School not found")
        
    ext = file.filename.split(".")[-1]
    filename = f"{school_id}.{ext}"
    
    s3_bucket = os.getenv("S3_BUCKET_NAME")
    aws_region = os.getenv("AWS_REGION")
    if not s3_bucket or not aws_region:
        raise HTTPException(status_code=500, detail="AWS S3 configuration is missing on the server.")
        
    try:
        s3_client = boto3.client(
            "s3",
            aws_access_key_id=os.getenv("AWS_ACCESS_KEY_ID"),
            aws_secret_access_key=os.getenv("AWS_SECRET_ACCESS_KEY"),
            region_name=aws_region
        )
        
        # Upload the file stream directly to S3
        s3_client.upload_fileobj(
            file.file,
            s3_bucket,
            f"logos/{filename}",
            ExtraArgs={"ContentType": file.content_type}
        )
    except Exception as e:
        print(f"[SCHOOLS] Failed to upload logo to S3: {e}")
        raise HTTPException(status_code=502, detail=f"Failed to upload logo to S3: {str(e)}")
        
    logo_url = f"https://{s3_bucket}.s3.{aws_region}.amazonaws.com/logos/{filename}"
    school.logo_url = logo_url
    db.commit()
    
    return {"success": True, "logo_url": logo_url}


@router.post("/{school_id}/change-email")
def change_school_email(school_id: str, payload: dict, db: Session = Depends(get_db), _admin: dict = Depends(require_admin)):
    """
    Re-points this school's login at a different email address.

    Cognito usernames are the email itself, so this is create-new + delete-old
    rather than an attribute edit. The new user is created FIRST: if creation
    fails (bad address, already taken, policy), the school keeps its existing
    working login instead of being left with none. The old user is only deleted
    once the new one exists.
    """
    from src import cognito

    school = db.query(School).filter(School.id == school_id).first()
    if not school:
        raise HTTPException(status_code=404, detail="School not found")

    new_email = (payload.get("admin_email") or "").strip().lower()
    if not new_email or "@" not in new_email or " " in new_email:
        raise HTTPException(status_code=400, detail="A valid email address is required")

    old_email = (school.admin_email or "").strip().lower()
    if new_email == old_email:
        raise HTTPException(status_code=400, detail="That is already this school's login email")

    if db.query(School).filter(School.admin_email == new_email, School.id != school.id).first():
        raise HTTPException(status_code=400, detail="Another school already uses that login email")

    # Without Cognito there is no login to move — just record the address.
    if not cognito.cognito_enabled():
        school.admin_email = new_email
        db.commit()
        return {
            "admin_email": new_email,
            "temp_password": None,
            "warning": "Cognito is not configured, so no login was created — only the recorded address changed.",
        }

    try:
        temp_password = cognito.create_school_user(new_email, school.id)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Could not create a login for {new_email}: {e}")

    removed_old = False
    if old_email:
        removed_old = cognito.delete_school_user(old_email)

    school.admin_email = new_email
    db.commit()

    return {
        "admin_email": new_email,
        "temp_password": temp_password,   # shown ONCE — not stored anywhere
        "old_login_removed": removed_old,
        "warning": None if (removed_old or not old_email) else (
            f"The new login works, but the old login {old_email} could not be removed "
            f"automatically — delete it in the Cognito console so it can't still sign in."
        ),
    }


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
            "school_slug": school.slug,
            "impersonated": True,
        },
    }


@router.patch("/{school_id}")
def update_school(
    school_id: str,
    payload: dict,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    _admin: dict = Depends(require_admin),
):
    school = db.query(School).filter(School.id == school_id).first()
    if not school:
        raise HTTPException(status_code=404, detail="School not found")

    identity_changed = False
    website_changed = False
    for field in ("name", "location", "contact_phone", "website", "status"):
        if field in payload and payload[field] is not None:
            value = (str(payload[field]) or "").strip()
            if getattr(school, field) != value:
                setattr(school, field, value)
                if field in ("name", "location", "contact_phone"):
                    identity_changed = True
                if field == "website":
                    website_changed = True
    db.commit()

    agent_error = None
    if identity_changed and school.retell_agent_id:
        agent_error = _provision_agent(db, school) or None

    # A new website means the existing chunks describe the wrong site — rebuild
    # this school's knowledge base from the new one.
    if website_changed and school.website:
        from src.knowledge import refresh_knowledge_base
        background_tasks.add_task(refresh_knowledge_base, school.id)

    return {
        "school": _serialize(db, school),
        "agent_error": agent_error,
        "knowledge_refreshing": website_changed and bool(school.website),
    }


@router.delete("/{school_id}")
def delete_school(school_id: str, db: Session = Depends(get_db), _admin: dict = Depends(require_admin)):
    school = db.query(School).filter(School.id == school_id).first()
    if not school:
        raise HTTPException(status_code=404, detail="School not found")

    # Protect default primary platform school
    if school.slug == "shri-ram-academy":
        raise HTTPException(
            status_code=400,
            detail="Cannot delete the default platform school (The Shri Ram Academy)."
        )

    from src.db import (
        Contact, UploadBatch, Counselor, CounselorActivity,
        Course, ClassType, ClassBooking, Appointment,
        ScheduledCallback, KnowledgeChunk, SchoolBillingSettings,
        VoiceProviderConfig, CallAttempt, CallCostSnapshot, AgentConfigVersion
    )

    # 1. Preserve immutable financial ledger & call snapshot records
    db.query(CallCostSnapshot).filter(CallCostSnapshot.school_id == school.id).update({
        "school_name": school.name,
        "school_id": None
    }, synchronize_session=False)

    db.query(CallAttempt).filter(CallAttempt.school_id == school.id).update({
        "school_id": None,
        "contact_id": None
    }, synchronize_session=False)

    # 2. Unlink contact calls and clean up contact-dependent rows
    contacts = db.query(Contact).filter(Contact.school_id == school.id).all()
    contact_ids = [c.id for c in contacts]
    if contact_ids:
        db.query(CallAttempt).filter(CallAttempt.contact_id.in_(contact_ids)).update({
            "contact_id": None
        }, synchronize_session=False)
        db.query(ScheduledCallback).filter(ScheduledCallback.contact_id.in_(contact_ids)).delete(synchronize_session=False)
        db.query(Appointment).filter(Appointment.contact_id.in_(contact_ids)).delete(synchronize_session=False)
        db.query(CounselorActivity).filter(CounselorActivity.contact_id.in_(contact_ids)).delete(synchronize_session=False)

    # 3. Clean up counselors and activity logs
    counselors = db.query(Counselor).filter(Counselor.school_id == school.id).all()
    counselor_ids = [cn.id for cn in counselors]
    if counselor_ids:
        db.query(CounselorActivity).filter(CounselorActivity.counselor_id.in_(counselor_ids)).delete(synchronize_session=False)

    from src import cognito
    if cognito.cognito_enabled():
        for cn in counselors:
            if cn.email:
                try:
                    cognito.delete_school_user(cn.email)
                except Exception as e:
                    print(f"[COGNITO] Failed deleting counselor {cn.email}: {e}")

    # 4. Clean up school-specific records
    db.query(ClassBooking).filter(ClassBooking.school_id == school.id).delete(synchronize_session=False)
    db.query(ClassType).filter(ClassType.school_id == school.id).delete(synchronize_session=False)
    db.query(Course).filter(Course.school_id == school.id).delete(synchronize_session=False)
    db.query(Contact).filter(Contact.school_id == school.id).delete(synchronize_session=False)
    db.query(UploadBatch).filter(UploadBatch.school_id == school.id).delete(synchronize_session=False)
    db.query(Counselor).filter(Counselor.school_id == school.id).delete(synchronize_session=False)
    db.query(KnowledgeChunk).filter(KnowledgeChunk.school_id == school.id).delete(synchronize_session=False)
    db.query(SchoolBillingSettings).filter(SchoolBillingSettings.school_id == school.id).delete(synchronize_session=False)
    db.query(VoiceProviderConfig).filter(VoiceProviderConfig.school_id == school.id).delete(synchronize_session=False)
    db.query(AgentConfigVersion).filter(AgentConfigVersion.school_id == school.id).delete(synchronize_session=False)

    # 5. Delete school admin login from Cognito
    if school.admin_email and cognito.cognito_enabled():
        try:
            cognito.delete_school_user(school.admin_email)
        except Exception as e:
            print(f"[COGNITO] Failed deleting school admin {school.admin_email}: {e}")

    # 6. Delete the School record
    db.delete(school)
    db.commit()

    # Invalidate caches
    from src.cache import cal_event_types_cache, school_cache
    cal_event_types_cache.invalidate()
    school_cache.invalidate()
    return {"success": True, "message": f"School '{school.name}' deleted successfully"}


# ── Per-school settings (calendar, Cal.com, SMTP, phone number) ──────────
# All optional: a school without these configured falls back to the shared
# platform config (src/school_settings.py) — this only lets an admin give a
# specific school its OWN calendar/Cal.com account/email sender/caller ID.

_SCHOOL_SETTING_FIELDS = [
    "retell_phone_number",
    "cal_com_api_key",
    "cal_com_event_link",
    "cal_com_virtual_event_slug",
    "cal_com_in_person_event_slug",
    "google_calendar_credentials_json",
    "google_calendar_id",
    "smtp_server",
    "smtp_port",
    "smtp_username",
    "smtp_password",
    "smtp_from_email",
]

_SECRET_FIELDS = {"google_calendar_credentials_json", "cal_com_api_key", "smtp_password"}

_SECRET_MASK = "••••••••••••••••"


def _effective_settings(db: Session, school: School) -> dict:
    """
    What each setting ACTUALLY resolves to for this school right now, and where
    that value comes from.

    The override-only view this endpoint used to return showed a blank box for
    anything the school hadn't overridden, which is indistinguishable from "not
    configured anywhere" — an admin couldn't tell whether a school would send
    email at all, let alone from which account. Each field here reports:
      value  - the resolved value (masked if secret)
      source - "school" (its own override), "platform" (shared default), or
               "unset" (nothing configured at either level)
    """
    from src.school_settings import (
        get_retell_phone_number, get_google_calendar_config,
        get_cal_com_config, get_smtp_config,
    )

    gcal = get_google_calendar_config(db, school)
    cal = get_cal_com_config(db, school)
    smtp = get_smtp_config(db, school)

    resolved = {
        "retell_phone_number": get_retell_phone_number(db, school),
        "cal_com_api_key": cal["api_key"],
        "cal_com_event_link": cal["event_link"],
        "cal_com_virtual_event_slug": cal["virtual_event_slug"],
        "cal_com_in_person_event_slug": cal["in_person_event_slug"],
        "google_calendar_credentials_json": gcal["credentials_json"],
        "google_calendar_id": gcal["calendar_id"],
        "smtp_server": smtp["server"],
        "smtp_port": smtp["port"],
        "smtp_username": smtp["username"],
        "smtp_password": smtp["password"],
        "smtp_from_email": smtp["from_email"],
    }

    out = {}
    for field in _SCHOOL_SETTING_FIELDS:
        value = resolved.get(field)
        has_override = bool(getattr(school, field, None))
        if value in (None, ""):
            source = "unset"
        elif has_override:
            source = "school"
        else:
            source = "platform"
        out[field] = {
            "value": _SECRET_MASK if (value and field in _SECRET_FIELDS) else (
                str(value) if value is not None else None
            ),
            "source": source,
            "secret": field in _SECRET_FIELDS,
        }
    return out


@router.get("/{school_id}/settings")
def get_school_settings(school_id: str, db: Session = Depends(get_db), _admin: dict = Depends(require_admin)):
    """
    Returns both:
      overrides - only what this school has set itself (what the edit form binds
                  to; blank means "inherit the platform default")
      effective - what each setting actually resolves to right now, and whether
                  that came from the school or the platform
    """
    school = db.query(School).filter(School.id == school_id).first()
    if not school:
        raise HTTPException(status_code=404, detail="School not found")

    overrides = {}
    for field in _SCHOOL_SETTING_FIELDS:
        value = getattr(school, field)
        if value and field in _SECRET_FIELDS:
            overrides[field] = _SECRET_MASK
        else:
            overrides[field] = value

    from src.school_settings import cal_com_is_configured
    from src.services.voice.provider_manager import provider_manager
    active_adapter = provider_manager.get_provider(school_id=school.id)
    caller_id = school.retell_phone_number or os.getenv("RETELL_PHONE_NUMBER", "+18645812715")

    return {
        "overrides": overrides,
        "effective": _effective_settings(db, school),
        "booking_provider": "cal.com" if cal_com_is_configured(db, school) else "google+smtp",
        "active_provider": active_adapter.provider_name,
        "caller_id": caller_id,
        "agent": {
            "internal_agent_id": school.id,
            "provider_agent_id": school.retell_agent_id or f"{active_adapter.provider_name}_agent_{school.slug}"
        },
        "phone": {
            "internal_phone_id": school.id,
            "provider_phone_id": caller_id
        }
    }


@router.patch("/{school_id}/settings")
def update_school_settings(school_id: str, updates: dict, db: Session = Depends(get_db), _admin: dict = Depends(require_admin)):
    school = db.query(School).filter(School.id == school_id).first()
    if not school:
        raise HTTPException(status_code=404, detail="School not found")

    if "active_provider" in updates and updates["active_provider"]:
        new_provider = str(updates["active_provider"]).lower().strip()
        if new_provider in ("retell", "omnidimension", "bolna"):
            from src.services.voice.provider_manager import provider_manager
            provider_manager.activate_provider(new_provider, school_id=school.id)

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
