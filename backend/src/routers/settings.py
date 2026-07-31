import os
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from src.db import get_db, Settings
from src.routers.auth import get_current_user

router = APIRouter(prefix="/api/settings", tags=["Settings"])

@router.get("")
def get_settings(db: Session = Depends(get_db), current_user: dict = Depends(get_current_user)):
    if current_user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin permissions required to view settings")
    settings_list = db.query(Settings).all()
    settings_map = {s.key: s.value for s in settings_list}

    # Keys to configure
    keys = [
        "retell_api_key",
        "retell_phone_number",
        "retell_agent_id",
        "local_agent_id",
        "google_calendar_credentials_json",
        "google_calendar_id",
        "ngrok_auth_token",
        "cal_com_api_key",
        "cal_com_event_link",
        # Which Cal.com event type each meeting kind books. Cal.com is the
        # primary path for booking + calendar event + confirmation email, so
        # these decide whether an attendee is emailed a video link or a campus
        # address. Resolved by slug — never by "first event type in the account".
        "cal_com_virtual_event_slug",
        "cal_com_in_person_event_slug",
        "ngrok_url",
        "aegis_tools_secret",
        "cal_com_webhook_secret",
        "concurrency_limit",
        "max_retry_attempts",
        "retry_backoff_hours",
        "smtp_server",
        "smtp_port",
        "smtp_username",
        "smtp_password",
        "smtp_from_email"
    ]

    response_map = {}
    for k in keys:
        db_val = settings_map.get(k)
        env_val = os.getenv(k.upper())
        val = db_val if db_val is not None else env_val

        # Mask secrets
        if val:
            if "secret" in k or k in ["retell_api_key", "ngrok_auth_token", "google_calendar_credentials_json", "smtp_password", "aegis_tools_secret", "cal_com_webhook_secret"]:
                response_map[k] = "••••••••••••••••"
            else:
                response_map[k] = val
        else:
            response_map[k] = ""

    return response_map

@router.post("")
def save_settings(
    updates: dict,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    if current_user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin permissions required to modify settings")
    try:
        for key, value in updates.items():
            if value == "••••••••••••••••":
                continue

            setting = db.query(Settings).filter(Settings.key == key).first()
            if not setting:
                setting = Settings(key=key, value=str(value))
                db.add(setting)
            else:
                setting.value = str(value)
            
            # Update process env
            os.environ[key.upper()] = str(value)

        db.commit()
        return {"success": True}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))
