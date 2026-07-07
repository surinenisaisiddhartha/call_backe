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
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Access token missing",
            headers={"WWW-Authenticate": "Bearer"},
        )
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[ALGORITHM])
        email: str = payload.get("email")
        if email is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid token claims",
            )
        return {"email": email, "role": payload.get("role", "admin")}
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token",
        )

@router.post("/login")
def login(payload: dict, db: Session = Depends(get_db)):
    email = payload.get("email")
    password = payload.get("password")

    if email == ADMIN_EMAIL and password == ADMIN_PASSWORD:
        access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
        access_token = create_access_token(
            data={"sub": email, "email": email, "role": "admin"},
            expires_delta=access_token_expires
        )
        return {"token": access_token, "user": {"email": email, "role": "admin"}}
    elif email == STAFF_EMAIL and password == STAFF_PASSWORD:
        access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
        access_token = create_access_token(
            data={"sub": email, "email": email, "role": "staff"},
            expires_delta=access_token_expires
        )
        return {"token": access_token, "user": {"email": email, "role": "staff"}}

    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid credentials.",
    )


