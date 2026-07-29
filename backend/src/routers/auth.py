import os
import json
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException, status, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from sqlalchemy.orm import Session
from src.db import get_db, Settings
from google_auth_oauthlib.flow import Flow

router = APIRouter(prefix="/api/auth", tags=["Authentication"])

DEFAULT_DEMO_JWT_SECRET = "demo_secret_key_12345678"
JWT_SECRET = os.getenv("JWT_SECRET", DEFAULT_DEMO_JWT_SECRET)
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 1440  # 24 hours

# Demo credentials are used as fallbacks so the app keeps working out of the
# box, but should be overridden via env vars (or Settings, once wired up)
# for any real deployment. Same applies to JWT_SECRET above.
ADMIN_EMAIL = os.getenv("ADMIN_EMAIL", "admin@callingagent.com")
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "password123")
STAFF_EMAIL = os.getenv("STAFF_EMAIL", "staff@callingagent.com")
STAFF_PASSWORD = os.getenv("STAFF_PASSWORD", "password123")

if JWT_SECRET == DEFAULT_DEMO_JWT_SECRET:
    print("[AUTH] WARNING: JWT_SECRET is still the default demo value. Set a real random JWT_SECRET before exposing this app publicly.")
if ADMIN_PASSWORD == "password123" or STAFF_PASSWORD == "password123":
    print("[AUTH] WARNING: using default demo login credentials. Set ADMIN_EMAIL/ADMIN_PASSWORD and STAFF_EMAIL/STAFF_PASSWORD env vars before exposing this app publicly.")

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="api/auth/login", auto_error=False)

def create_access_token(data: dict, expires_delta: timedelta = None):
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=15)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, JWT_SECRET, algorithm=ALGORITHM)
    return encoded_jwt

def get_current_user(token: str = Depends(oauth2_scheme)):
    """
    Accepts EITHER a legacy local JWT (demo/env-var admin+staff logins) OR a
    Cognito ID token (school users / platform admins), so both auth systems
    coexist: Cognito activates purely via env vars, and nothing breaks for
    deployments that haven't configured it yet.
    Returns {"email", "role": "admin"|"school"|"staff", "school_id"|None}.
    """
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Access token missing",
            headers={"WWW-Authenticate": "Bearer"},
        )
    # 1) Legacy local JWT
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[ALGORITHM])
        email: str = payload.get("email")
        if email:
            return {"email": email, "role": payload.get("role", "admin"), "school_id": None}
    except JWTError:
        pass
    # 2) Cognito ID token
    from src import cognito
    if cognito.cognito_enabled():
        try:
            claims = cognito.verify_id_token(token)
            return cognito.claims_to_user(claims)
        except Exception:
            pass
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid token",
    )


def require_admin(user: dict = Depends(get_current_user)) -> dict:
    """Platform-admin gate for tenant management endpoints."""
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Platform admin access required")
    return user


def _user_with_school_name(user: dict, db: Session) -> dict:
    """Attach school_name for the frontend header/branding."""
    out = dict(user)
    out["school_name"] = None
    if user.get("school_id"):
        from src.db import School
        school = db.query(School).filter(School.id == user["school_id"]).first()
        if school:
            out["school_name"] = school.name
    return out


@router.post("/login")
def login(payload: dict, db: Session = Depends(get_db)):
    email = payload.get("email")
    password = payload.get("password")

    # Legacy env-var/demo logins always work (platform admin fallback), so a
    # deployment without Cognito configured — or with Cognito down — is never
    # locked out of its own dashboard.
    if email == ADMIN_EMAIL and password == ADMIN_PASSWORD:
        access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
        access_token = create_access_token(
            data={"sub": email, "email": email, "role": "admin"},
            expires_delta=access_token_expires
        )
        return {"token": access_token, "user": {"email": email, "role": "admin", "school_id": None, "school_name": None}}
    elif email == STAFF_EMAIL and password == STAFF_PASSWORD:
        access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
        access_token = create_access_token(
            data={"sub": email, "email": email, "role": "staff"},
            expires_delta=access_token_expires
        )
        return {"token": access_token, "user": {"email": email, "role": "staff", "school_id": None, "school_name": None}}

    # Cognito login for onboarded school users (and Cognito-managed admins)
    from src import cognito
    if cognito.cognito_enabled() and email and password:
        try:
            result = cognito.login(email, password)
            if result.get("challenge") == "NEW_PASSWORD_REQUIRED":
                # First login with the temp password — frontend must collect a
                # new password and call /set-new-password with this session.
                return {"challenge": "NEW_PASSWORD_REQUIRED", "session": result["session"], "email": email}
            user = cognito.claims_to_user(result["claims"])
            return {"token": result["id_token"], "user": _user_with_school_name(user, db)}
        except Exception as e:
            print(f"[AUTH] Cognito login failed for {email}: {e}")

    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid credentials.",
    )


@router.post("/set-new-password")
def set_new_password(payload: dict, db: Session = Depends(get_db)):
    """Completes a first-login NEW_PASSWORD_REQUIRED challenge."""
    from src import cognito
    if not cognito.cognito_enabled():
        raise HTTPException(status_code=400, detail="Cognito is not configured")
    email = payload.get("email")
    new_password = payload.get("new_password")
    session = payload.get("session")
    if not (email and new_password and session):
        raise HTTPException(status_code=400, detail="email, new_password and session are required")
    try:
        result = cognito.respond_new_password(email, new_password, session)
    except Exception as e:
        print(f"[AUTH] set-new-password failed for {email}: {e}")
        raise HTTPException(status_code=400, detail="Could not set the new password — it may not meet the password policy (min 8 chars with upper, lower, digit).")
    user = cognito.claims_to_user(result["claims"])
    return {"token": result["id_token"], "user": _user_with_school_name(user, db)}


@router.get("/me")
def me(user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    return _user_with_school_name(user, db)


