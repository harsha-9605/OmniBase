from typing import Optional
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.auth import decode_access_token
from app.database import get_session
from app.models import Account, User, UserRole

# FastAPI will look for "Authorization: Bearer <token>" header
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/token")


# ── Step 1: Is the user logged in? ────────────────────────────────────────────
async def get_current_account(
    token: str = Depends(oauth2_scheme),
    session: AsyncSession = Depends(get_session),
) -> Account:
    """Decode the JWT, load and return the Account from DB."""
    credentials_exc = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid or expired token",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = decode_access_token(token)
        account_id: Optional[int] = int(payload.get("sub"))
        if account_id is None:
            raise credentials_exc
    except (JWTError, ValueError):
        raise credentials_exc

    result = await session.execute(select(Account).where(Account.id == account_id))
    account = result.scalar_one_or_none()
    if account is None:
        raise credentials_exc
    return account


# ── Step 2: Which tenant are they using? ──────────────────────────────────────
async def get_tenant_context(
    current_account: Account = Depends(get_current_account),
) -> int:
    """Extract the active tenant_id from the authenticated account.

    Raises 400 if the account has no active tenant yet (e.g. freshly registered).
    """
    if current_account.last_active_tenant_id is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No active tenant. Create or join a tenant first.",
        )
    return current_account.last_active_tenant_id


# ── Step 3: Are they actually a MEMBER of that tenant? ────────────────────────
async def get_verified_membership(
    current_account: Account = Depends(get_current_account),
    session: AsyncSession = Depends(get_session),
) -> User:
    """THE PRIVACY WALL.

    Runs before every tenant-scoped request:
      1. Confirms the user is logged in (JWT valid).
      2. Confirms they have an active tenant.
      3. Confirms they are an actual MEMBER of that tenant (row in User table).

    If any check fails → 403 Forbidden. The database is never touched for data.

    Returns the User membership record, which carries the caller's role
    (Admin / Manager / User) so routes can enforce role-based permissions.
    """
    tenant_id = current_account.last_active_tenant_id
    if tenant_id is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No active tenant. Create or join a tenant first.",
        )

    result = await session.execute(
        select(User).where(
            User.account_id == current_account.id,
            User.tenant_id == tenant_id,
        )
    )
    membership = result.scalar_one_or_none()

    if membership is None:
        # They have a tenant_id in their token but no membership row — data leak attempt
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not a member of this tenant.",
        )

    return membership   # carries .tenant_id and .role for the calling route
