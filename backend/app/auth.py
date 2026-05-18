import os
from datetime import datetime, timedelta
from typing import Optional

import bcrypt
from dotenv import load_dotenv
from jose import JWTError, jwt

load_dotenv()

# ── Secret key ────────────────────────────────────────────────────────────────
SECRET_KEY = os.getenv("SECRET_KEY", "change-me-before-going-to-production-please")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24  # 24 hours

# ── Password hashing ───────────────────────────────────────────────────────────
def hash_password(plain_password: str) -> str:
    return bcrypt.hashpw(plain_password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")

def verify_password(plain_password: str, hashed_password: str) -> bool:
    return bcrypt.checkpw(plain_password.encode("utf-8"), hashed_password.encode("utf-8"))

# ── JWT ────────────────────────────────────────────────────────────────────────
def create_access_token(account_id: int) -> str:
    payload = {
        "sub": str(account_id),
        "exp": datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES),
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)

def decode_access_token(token: str) -> dict:
    """Decode JWT and return the raw payload dict.
    Raises JWTError if invalid or expired."""
    return jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
