"""
AWS Cognito integration — optional, activated entirely by env vars.

When COGNITO_USER_POOL_ID / COGNITO_CLIENT_ID / COGNITO_REGION are set:
  - Login is proxied through the backend (InitiateAuth USER_PASSWORD_AUTH) so
    the frontend keeps its plain email/password form — no Amplify/SRP SDK.
  - School users are created by the platform admin via AdminCreateUser with a
    custom:school_id attribute binding them to their tenant; the generated
    temporary password is shown once in the admin UI (MessageAction=SUPPRESS,
    so no SES email setup is required).
  - Tokens are Cognito ID tokens, verified against the pool's JWKS.

When those env vars are NOT set, everything in here reports disabled and the
legacy demo JWT login in auth.py keeps working unchanged — so existing
deployments don't break the moment this code ships.
"""
import os
import json
import secrets
import string
import time
import urllib.request

COGNITO_REGION = os.getenv("COGNITO_REGION", "")
COGNITO_USER_POOL_ID = os.getenv("COGNITO_USER_POOL_ID", "")
COGNITO_CLIENT_ID = os.getenv("COGNITO_CLIENT_ID", "")
# Only set when the app client is a CONFIDENTIAL client (Cognito's "Traditional
# web application" type). Cognito then requires a SECRET_HASH on the auth calls.
# Left empty for a public client (SPA type) — both are supported.
COGNITO_CLIENT_SECRET = os.getenv("COGNITO_CLIENT_SECRET", "")

_jwks_cache = {"keys": None, "fetched_at": 0}
JWKS_TTL_SECONDS = 3600


def cognito_enabled() -> bool:
    return bool(COGNITO_REGION and COGNITO_USER_POOL_ID and COGNITO_CLIENT_ID)


def _client():
    import boto3
    return boto3.client("cognito-idp", region_name=COGNITO_REGION)


def _secret_hash(username: str) -> str | None:
    """
    Cognito's SECRET_HASH for a confidential app client:
    Base64(HMAC-SHA256(username + client_id, key=client_secret)).
    Returns None for a public client (no secret configured), in which case the
    parameter must be omitted entirely rather than sent empty.
    """
    if not COGNITO_CLIENT_SECRET:
        return None
    import base64, hashlib, hmac
    digest = hmac.new(
        COGNITO_CLIENT_SECRET.encode("utf-8"),
        (username + COGNITO_CLIENT_ID).encode("utf-8"),
        hashlib.sha256,
    ).digest()
    return base64.b64encode(digest).decode()


def _issuer() -> str:
    return f"https://cognito-idp.{COGNITO_REGION}.amazonaws.com/{COGNITO_USER_POOL_ID}"


def _get_jwks() -> dict:
    now = time.time()
    if _jwks_cache["keys"] and now - _jwks_cache["fetched_at"] < JWKS_TTL_SECONDS:
        return _jwks_cache["keys"]
    with urllib.request.urlopen(f"{_issuer()}/.well-known/jwks.json", timeout=10) as resp:
        jwks = json.loads(resp.read())
    _jwks_cache["keys"] = jwks
    _jwks_cache["fetched_at"] = now
    return jwks


def verify_id_token(token: str) -> dict:
    """
    Verifies a Cognito ID token's signature (via the pool's JWKS), issuer,
    audience, and expiry. Returns the claims dict, or raises.
    """
    from jose import jwt
    headers = jwt.get_unverified_header(token)
    kid = headers.get("kid")
    jwks = _get_jwks()
    key = next((k for k in jwks.get("keys", []) if k.get("kid") == kid), None)
    if key is None:
        # Key rotation — refetch once before giving up.
        _jwks_cache["keys"] = None
        jwks = _get_jwks()
        key = next((k for k in jwks.get("keys", []) if k.get("kid") == kid), None)
    if key is None:
        raise ValueError("Token signing key not found in Cognito JWKS")

    claims = jwt.decode(
        token, key,
        algorithms=[key.get("alg", "RS256")],
        audience=COGNITO_CLIENT_ID,
        issuer=_issuer(),
    )
    if claims.get("token_use") != "id":
        raise ValueError("Not an ID token")
    return claims


def login(email: str, password: str) -> dict:
    """
    Backend-proxied Cognito login. Returns one of:
      {"challenge": "NEW_PASSWORD_REQUIRED", "session": "..."}  — first login
      {"id_token": "...", "claims": {...}}                       — success
    Raises botocore ClientError (NotAuthorizedException etc.) on bad creds.
    """
    client = _client()
    auth_params = {"USERNAME": email, "PASSWORD": password}
    sh = _secret_hash(email)
    if sh:
        auth_params["SECRET_HASH"] = sh
    resp = client.initiate_auth(
        ClientId=COGNITO_CLIENT_ID,
        AuthFlow="USER_PASSWORD_AUTH",
        AuthParameters=auth_params,
    )
    if resp.get("ChallengeName") == "NEW_PASSWORD_REQUIRED":
        return {"challenge": "NEW_PASSWORD_REQUIRED", "session": resp["Session"]}
    id_token = resp["AuthenticationResult"]["IdToken"]
    return {"id_token": id_token, "claims": verify_id_token(id_token)}


def respond_new_password(email: str, new_password: str, session: str) -> dict:
    """Completes the NEW_PASSWORD_REQUIRED challenge from a first login."""
    client = _client()
    challenge_responses = {"USERNAME": email, "NEW_PASSWORD": new_password}
    sh = _secret_hash(email)
    if sh:
        challenge_responses["SECRET_HASH"] = sh
    resp = client.respond_to_auth_challenge(
        ClientId=COGNITO_CLIENT_ID,
        ChallengeName="NEW_PASSWORD_REQUIRED",
        Session=session,
        ChallengeResponses=challenge_responses,
    )
    id_token = resp["AuthenticationResult"]["IdToken"]
    return {"id_token": id_token, "claims": verify_id_token(id_token)}


def generate_temp_password(length: int = 12) -> str:
    """Meets Cognito's default policy: upper + lower + digit + symbol."""
    alphabet = string.ascii_letters + string.digits
    core = "".join(secrets.choice(alphabet) for _ in range(length - 4))
    return (
        secrets.choice(string.ascii_uppercase)
        + secrets.choice(string.ascii_lowercase)
        + secrets.choice(string.digits)
        + secrets.choice("!@#$%")
        + core
    )


def create_school_user(email: str, school_id: str) -> str:
    """
    Creates the school's Cognito login bound to its tenant via
    custom:school_id. Cognito emails the temporary password directly to the
    school (its default "invitation" email — no MessageAction=SUPPRESS), so
    the caller doesn't need to relay it manually. The password is still
    returned so the admin UI can show it too, as a fallback in case the
    email doesn't land (spam filters, Cognito's own send-rate limits, etc).
    """
    client = _client()
    temp_password = generate_temp_password()
    client.admin_create_user(
        UserPoolId=COGNITO_USER_POOL_ID,
        Username=email,
        TemporaryPassword=temp_password,
        UserAttributes=[
            {"Name": "email", "Value": email},
            {"Name": "email_verified", "Value": "true"},
            {"Name": "custom:school_id", "Value": school_id},
        ],
    )
    return temp_password


def delete_school_user(email: str) -> bool:
    try:
        _client().admin_delete_user(UserPoolId=COGNITO_USER_POOL_ID, Username=email)
        return True
    except Exception as e:
        print(f"[COGNITO] delete user failed for {email}: {e}")
        return False


def claims_to_user(claims: dict) -> dict:
    """
    Maps Cognito ID-token claims to the app's user dict. Users in the
    'platform-admin' Cognito group are platform admins (see all schools);
    users with custom:school_id are that school's operators.
    """
    groups = claims.get("cognito:groups") or []
    school_id = claims.get("custom:school_id")
    if "platform-admin" in groups:
        role = "admin"
        school_id = None
    elif school_id:
        role = "school"
    else:
        role = "staff"
    return {"email": claims.get("email"), "role": role, "school_id": school_id}
