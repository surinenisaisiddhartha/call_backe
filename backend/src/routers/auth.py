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
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 1440  # 24 hours

# This key signs the short-lived "view as school" impersonation tokens minted
# from the Schools admin page, so a known or empty key means anyone can forge a
# token scoped to any tenant.
#
# Two ways that used to happen silently:
#   - the published demo default was used when JWT_SECRET was absent, and
#   - os.getenv only substitutes its default when the variable is ABSENT, not
#     when it is EMPTY. docker-compose passes `JWT_SECRET=${JWT_SECRET}`, which
#     is an empty string when the deploy environment hasn't set it — that
#     produced an empty signing key AND skipped the demo-value warning below.
#
# So treat unset, empty and the demo default identically, and fall back to a
# random per-process key rather than a guessable one. The cost is that
# impersonation tokens don't survive a restart (they're 2-hour support tokens);
# the alternative is forgeable tenant access.
_configured_jwt_secret = (os.getenv("JWT_SECRET") or "").strip()
if not _configured_jwt_secret or _configured_jwt_secret == DEFAULT_DEMO_JWT_SECRET:
    import secrets as _secrets
    JWT_SECRET = _secrets.token_urlsafe(48)
    print(
        "[AUTH] WARNING: JWT_SECRET is unset, empty, or still the demo default — "
        "generated a random per-process key instead. 'View as school' tokens will "
        "stop working after a restart. Set a real random JWT_SECRET to fix this."
    )
else:
    JWT_SECRET = _configured_jwt_secret

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
    """
    Attach school_name for the header/branding, and school_slug — which the
    frontend puts in the URL (#<slug>/<tab>) so a link says which school's
    dashboard it points at.
    """
    out = dict(user)
    out["school_name"] = None
    out["school_slug"] = None
    if user.get("school_id"):
        from src.db import School
        school = db.query(School).filter(School.id == user["school_id"]).first()
        if school:
            out["school_name"] = school.name
            out["school_slug"] = school.slug
    return out


# Public email domains can never identify a tenant: if a school's own login
# happens to be an @gmail.com address, domain-matching on it would map EVERY
# gmail user in the world to that school. Domain resolution is therefore only
# ever done against a school's registered website host, and never against
# these.
_PUBLIC_EMAIL_DOMAINS = {
    "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com",
    "yahoo.com", "yahoo.co.in", "yahoo.co.uk", "icloud.com", "me.com",
    "aol.com", "proton.me", "protonmail.com", "pm.me", "zoho.com",
    "rediffmail.com", "mail.com", "yandex.com", "gmx.com", "fastmail.com",
}


def _website_host(website: str) -> str:
    """The bare hostname of a school's website, lowercased, without 'www.'."""
    from urllib.parse import urlparse
    raw = (website or "").strip()
    if not raw:
        return ""
    if not raw.startswith(("http://", "https://")):
        raw = f"https://{raw}"
    host = (urlparse(raw).netloc or "").lower().split(":")[0]
    return host[4:] if host.startswith("www.") else host


def resolve_school_for_email(db: Session, email: str):
    """
    Which school an email belongs to, for the email-first login step.

    Two ways, in order:
      1. it is a school's registered login address (exact, case-insensitive)
      2. its domain matches a school's own website host — so anyone at
         @theirschool.edu lands on that school, not just the one admin address

    Returns the School row, or None. Never raises: an unrecognised email is a
    normal outcome, not an error.
    """
    from src.db import School
    from sqlalchemy import func

    email = (email or "").strip().lower()
    if "@" not in email:
        return None

    school = db.query(School).filter(func.lower(School.admin_email) == email).first()
    if school:
        return school

    domain = email.rpartition("@")[2]
    if not domain or domain in _PUBLIC_EMAIL_DOMAINS:
        return None
    for candidate in db.query(School).filter(School.website.isnot(None)).all():
        if _website_host(candidate.website) == domain:
            return candidate
    return None


@router.post("/identify")
def identify(payload: dict, db: Session = Depends(get_db)):
    """
    Step 1 of login: given just an email, say which school it belongs to so the
    password step can be branded with it.

    This endpoint is deliberately non-committal about whether an account
    exists. It ALWAYS reports that the caller should continue to the password
    step, and an unrecognised address is indistinguishable from a recognised
    one that simply has no school (a platform admin). Otherwise this would be
    a free account-enumeration oracle: it is unauthenticated, so anyone could
    probe addresses and learn which are registered.

    Knowing an address belongs to a school is still information — that is
    inherent to the feature being asked for — but "this address exists" is not
    leaked, and a wrong password fails identically either way.
    """
    email = (payload.get("email") or "").strip()
    if not email or "@" not in email:
        raise HTTPException(status_code=400, detail="Enter a valid email address")

    school = resolve_school_for_email(db, email)
    return {
        "email": email,
        "school_name": school.name if school else None,
        "school_slug": school.slug if school else None,
        "school_location": school.location if school else None,
        # Always true — see the docstring. The client uses this to advance to
        # the password step regardless of whether a school was matched.
        "next": "password",
    }


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


