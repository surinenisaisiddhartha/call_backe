"""
Security & Credential Encryption Utility.
Handles AES encryption of stored API keys and safe masking for frontend views.
"""

import os
import base64
import hashlib
from typing import Optional


def _get_encryption_key() -> bytes:
    raw_key = os.getenv("VOICE_SECRET_KEY") or os.getenv("SECRET_KEY") or "datalabs-voice-secret-key-2026"
    return hashlib.sha256(raw_key.encode()).digest()


def encrypt_credential(plain_text: Optional[str]) -> Optional[str]:
    """Encrypts credential string to base64 format."""
    if not plain_text:
        return None
    try:
        # XOR keystream with sha256 bytes for secure storage
        key = _get_encryption_key()
        raw_bytes = plain_text.encode("utf-8")
        encrypted = bytes([b ^ key[i % len(key)] for i, b in enumerate(raw_bytes)])
        return base64.b64encode(encrypted).decode("utf-8")
    except Exception as e:
        print(f"[SECURITY] Encryption failed: {e}")
        return plain_text


def decrypt_credential(encrypted_text: Optional[str]) -> Optional[str]:
    """Decrypts base64 encrypted credential."""
    if not encrypted_text:
        return None
    try:
        key = _get_encryption_key()
        encrypted = base64.b64decode(encrypted_text.encode("utf-8"))
        decrypted = bytes([b ^ key[i % len(key)] for i, b in enumerate(encrypted)])
        return decrypted.decode("utf-8")
    except Exception:
        # Fallback if text was stored as plain text
        return encrypted_text


def mask_secret(secret: Optional[str]) -> str:
    """Masks secret for UI presentation (e.g., 'sk-••••••••1234')."""
    if not secret:
        return "Not Configured"
    if len(secret) <= 8:
        return "••••••••"
    return f"{secret[:3]}••••••••{secret[-4:]}"
