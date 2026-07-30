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

if JWT_SECRET == DEFAULT_DEMO_JWT_SECRET:
    print("[AUTH] WARNING: JWT_SECRET is still the default demo value. Set a real random JWT_SECRET — it still signs the short-lived 'view as school' impersonation tokens minted from the Schools admin page.")

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
    All real logins are Cognito ID tokens now — school users and platform
    admins (via the 'platform-admin' Cognito group) alike. The only thing
    still locally signed with JWT_SECRET is the short-lived 'view as school'
    token an already-authenticated admin mints from the Schools page
    (src/routers/schools.py::view_as_school) to preview a tenant's dashboard;
    nothing mints a local admin token anymore, so decoding one here can never
    grant admin access on its own.
    Returns {"email", "role": "admin"|"school"|"staff", "school_id"|None}.
    """
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Access token missing",
            headers={"WWW-Authenticate": "Bearer"},
        )
    # 1) Local JWT — only ever a "view as school" impersonation token
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[ALGORITHM])
        email: str = payload.get("email")
        if email:
            return {
                "email": email,
                "role": payload.get("role", "school"),
                "school_id": payload.get("school_id"),
                "impersonated": payload.get("impersonated", False),
            }
    except JWTError:
        pass
    # 2) Cognito ID token — the real login path
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

    # Cognito is the only login path — school users and platform admins
    # (via the 'platform-admin' Cognito group) both authenticate here.
    from src import cognito
    if not cognito.cognito_enabled():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Login is unavailable: Cognito is not configured (COGNITO_* env vars missing).",
        )
    if email and password:
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


