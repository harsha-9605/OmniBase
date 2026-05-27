import json
from typing import Optional
from fastapi import Depends, HTTPException, status, Header, Request
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.auth import decode_access_token
from app.database import get_session
from app.models import Account, User, UserRole

# FastAPI will look for "Authorization: Bearer <token>" header
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/token")


async def clear_account_cache(account_id: int, redis_client) -> None:
    """Invalidate the cached session/account from Redis."""
    if not redis_client:
        return
    try:
        await redis_client.delete(f"session:account_id:{account_id}")
        print(f"Session Cache Invalidation: Deleted cached session for account {account_id}")
    except Exception as e:
        print(f"Error invalidating account cache for {account_id}: {e}")


# ── Step 1: Is the user logged in? ────────────────────────────────────────────
async def get_current_account(
    request: Request,
    token: str = Depends(oauth2_scheme),
    session: AsyncSession = Depends(get_session),
) -> Account:
    """Decode the JWT, load and return the Account (checking Redis cache first)."""
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

    # ── Check Redis Session Cache ─────────────────────────────────────────────
    redis_client = getattr(request.app.state, "arq_pool", None)
    cache_key = f"session:account_id:{account_id}"
    if redis_client:
        try:
            cached_val = await redis_client.get(cache_key)
            if cached_val:
                print(f"Session Cache Hit: Loaded account {account_id} from Redis.")
                account_dict = json.loads(cached_val)
                # Reconstruct SQLModel instance
                account = Account.model_validate(account_dict)
                from app.database import account_context
                account_context.set(account_id)
                return account
        except Exception as e:
            print(f"Redis Session GET exception: {e}")

    # Fetch from Database on cache miss
    result = await session.execute(select(Account).where(Account.id == account_id))
    account = result.scalar_one_or_none()
    if account is None:
        raise credentials_exc
    
    # ── Populate Cache ────────────────────────────────────────────────────────
    if redis_client:
        try:
            await redis_client.setex(cache_key, 3600, account.model_dump_json())
            print(f"Session Cache Miss: Cached account {account_id} in Redis (1h TTL).")
        except Exception as e:
            print(f"Redis Session SET exception: {e}")

    from app.database import account_context
    account_context.set(account_id)
    return account


# ── Step 2: Which tenant are they using? ──────────────────────────────────────
async def get_tenant_context(
    x_tenant_id: Optional[str] = Header(None, alias="X-Tenant-ID"),
    current_account: Account = Depends(get_current_account),
) -> int:
    """Extract the active tenant_id from the X-Tenant-ID header with a fallback to the database record.

    Raises 400 if no tenant context can be resolved.
    """
    if x_tenant_id is not None:
        try:
            tenant_id = int(x_tenant_id)
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid X-Tenant-ID header format.",
            )
    else:
        if current_account.last_active_tenant_id is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="No active tenant. Create or join a tenant first.",
            )
        tenant_id = current_account.last_active_tenant_id

    from app.database import tenant_context
    tenant_context.set(tenant_id)
    return tenant_id



# ── Step 3: Are they actually a MEMBER of that tenant? ────────────────────────
async def get_verified_membership(
    tenant_id: int = Depends(get_tenant_context),
    current_account: Account = Depends(get_current_account),
    session: AsyncSession = Depends(get_session),
) -> User:
    """THE PRIVACY WALL.

    Runs before every tenant-scoped request:
      1. Confirms the user is logged in (JWT valid).
      2. Confirms they have an active tenant context.
      3. Confirms they are an actual MEMBER of that tenant (row in User table).

    If any check fails → 403 Forbidden. The database is never touched for data.

    Returns the User membership record, which carries the caller's role
    (Admin / Manager / User) so routes can enforce role-based permissions.
    """
    result = await session.execute(
        select(User).where(
            User.account_id == current_account.id,
            User.tenant_id == tenant_id,
        )
    )
    membership = result.scalar_one_or_none()

    if membership is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not a member of this tenant.",
        )

    return membership   # carries .tenant_id and .role for the calling route

