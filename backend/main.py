from contextlib import asynccontextmanager
import os, re, urllib.request, urllib.parse, json
from typing import Optional
from fastapi import FastAPI, Depends, HTTPException, status, WebSocket, WebSocketDisconnect, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import BaseModel, EmailStr
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select
from sqlalchemy import delete, update
from arq import create_pool
from arq.connections import RedisSettings
from urllib.parse import urlparse

from app.database import get_session
from app.models import (
    Tenant, TenantCreate,
    User, UserCreate,
    Account, AccountCreate,
    Project, ProjectCreate, ProjectRead,
    ProjectMember, ChannelRole,
    Message, MessageRead,
    Reaction,
    Invitation,
    UserProjectState, Notification,
)
from app.auth import hash_password, verify_password, create_access_token, decode_access_token
from app.dependencies import get_current_account, get_tenant_context, get_verified_membership, clear_account_cache
from app.connection_manager import manager as ws_manager

GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "")
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")

# Parse Redis URL for RedisSettings
parsed_redis = urlparse(REDIS_URL)
redis_host = parsed_redis.hostname or "localhost"
redis_port = parsed_redis.port or 6379
redis_password = parsed_redis.password or None

# Pydantic schema for JSON-body login
class LoginRequest(BaseModel):
    email: EmailStr
    password: str

class SignupRequest(BaseModel):
    name: str
    email: EmailStr
    password: str

class GoogleAuthRequest(BaseModel):
    access_token: str


import asyncio

async def redis_pubsub_listener(app: FastAPI):
    """Background listener that subscribes to ws_channel_broadcast and forwards messages to local sockets."""
    pool = getattr(app.state, "arq_pool", None)
    if not pool:
        print("PubSub Listener: Redis pool not available, exiting listener.")
        return

    pubsub = pool.pubsub()
    await pubsub.subscribe("ws_channel_broadcast")
    print("Subscribed to Redis Pub/Sub: ws_channel_broadcast")

    try:
        async for message in pubsub.listen():
            if message["type"] == "message":
                try:
                    data = json.loads(message["data"])
                    msg_type = data.get("type")
                    target_id = data.get("target_id")
                    payload = data.get("payload")

                    if msg_type == "project":
                        await ws_manager.broadcast_local(payload, target_id)
                    elif msg_type == "personal":
                        await ws_manager.personal_broadcast_local(payload, target_id)
                except Exception as e:
                    print(f"PubSub Listener error parsing message: {e}")
    except asyncio.CancelledError:
        print("PubSub Listener task cancelled.")
    except Exception as e:
        print(f"PubSub Listener encountered connection error: {e}")
    finally:
        try:
            await pubsub.unsubscribe("ws_channel_broadcast")
            await pubsub.close()
        except Exception:
            pass
        print("PubSub Listener closed connection.")


@asynccontextmanager
async def lifespan(app: FastAPI):
    print("OmniBase API starting up. Connecting to Redis...")
    try:
        app.state.arq_pool = await create_pool(
            RedisSettings(
                host=redis_host,
                port=redis_port,
                password=redis_password,
            )
        )
        print("Connected to Redis successfully.")
        ws_manager.redis_client = app.state.arq_pool
        app.state.pubsub_task = asyncio.create_task(redis_pubsub_listener(app))
    except Exception as e:
        print(f"Warning: Failed to connect to Redis: {e}. Background tasks will fall back to synchronous execution.")
        app.state.arq_pool = None
        app.state.pubsub_task = None
        ws_manager.redis_client = None
    yield
    if getattr(app.state, "pubsub_task", None):
        app.state.pubsub_task.cancel()
        try:
            await app.state.pubsub_task
        except asyncio.CancelledError:
            pass
    if getattr(app.state, "arq_pool", None):
        await app.state.arq_pool.close()
        print("Redis pool closed.")
class RateLimiter:
    def __init__(self, limit: int, window: int = 60, route_name: str = "default"):
        self.limit = limit
        self.window = window
        self.route_name = route_name

    async def __call__(self, request: Request):
        redis_client = getattr(request.app.state, "arq_pool", None)
        if not redis_client:
            return  # Bypass rate limiter if Redis is not configured
        
        ip = request.client.host if request.client else "127.0.0.1"
        key = f"ratelimit:ip:{ip}:route:{self.route_name}"
        
        try:
            count = await redis_client.incr(key)
            if count == 1:
                await redis_client.expire(key, self.window)
            
            if count > self.limit:
                raise HTTPException(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    detail=f"Too many requests on {self.route_name}. Please try again in {self.window} seconds."
                )
        except HTTPException:
            raise
        except Exception as e:
            print(f"Rate Limiter Exception: {e}")


app = FastAPI(
    title="OmniBase API",
    description="B2B SaaS backend — Account / Tenant / User architecture",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        # Production URLs
        "https://omnibase.onrender.com",
        "https://omnibase-backend.onrender.com",
        # Local development
        "http://localhost:5173",
        "http://localhost:5174",
        "http://localhost:3000",
        "http://127.0.0.1:5173",
        "http://127.0.0.1:5174",
        "http://127.0.0.1:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ─────────────────────────────────────────────────────────────────────────────
# HEALTH
# ─────────────────────────────────────────────────────────────────────────────

@app.get("/", tags=["Health"])
async def root():
    return {"message": "OmniBase API is running"}

@app.get("/api/health", tags=["Health"])
async def health_check():
    return {"status": "ok"}


# ─────────────────────────────────────────────────────────────────────────────
# AUTH — Register & Login
# ─────────────────────────────────────────────────────────────────────────────

@app.post("/accounts/register", dependencies=[Depends(RateLimiter(limit=5, route_name="register"))], response_model=dict, tags=["Auth"])
async def register(
    account_in: AccountCreate,
    session: AsyncSession = Depends(get_session),
):
    """Sign up with name, email, and password.
    Returns account_id. last_active_tenant_id starts as None."""
    # Check duplicate email
    existing = await session.execute(
        select(Account).where(Account.email == account_in.email)
    )
    if existing.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="An account with this email already exists.",
        )

    account = Account(
        name=account_in.name,
        email=account_in.email,
        hashed_password=hash_password(account_in.password),
        last_active_tenant_id=None,  # Always None on registration
    )
    session.add(account)
    await session.commit()
    await session.refresh(account)
    return {"message": "Account created successfully", "account_id": account.id, "name": account.name}


@app.post("/auth/signup", dependencies=[Depends(RateLimiter(limit=5, route_name="signup"))], response_model=dict, tags=["Auth"])
async def auth_signup(
    body: SignupRequest,
    session: AsyncSession = Depends(get_session),
):
    """Composite route: creates Account, default Tenant, and default Project."""
    # 1. Check duplicate email
    existing = await session.execute(
        select(Account).where(Account.email == body.email)
    )
    if existing.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="An account with this email already exists.",
        )

    # 2. Create Account
    account = Account(
        name=body.name,
        email=body.email,
        hashed_password=hash_password(body.password),
        last_active_tenant_id=None,
    )
    session.add(account)
    await session.flush() # flush to get account.id

    # 3. Create default Tenant
    tenant_name = f"{body.name}'s Workspace"
    import re
    # Simple slug generation based on name + account ID
    base_slug = re.sub(r'[^a-z0-9]+', '-', tenant_name.lower()).strip('-')
    slug = f"{base_slug}-{account.id}"
    
    tenant = Tenant(name=tenant_name, slug=slug)
    session.add(tenant)
    await session.flush() # flush to get tenant.id
    
    # 4. Create User (Membership) - Admin
    membership = User(
        account_id=account.id,
        tenant_id=tenant.id,
        role="Admin",
    )
    session.add(membership)
    
    # 5. Create default Projects
    p1 = Project(name="new-channel", description="Project discussions and files", tenant_id=tenant.id, created_by=account.id)
    p2 = Project(name=f"all-{base_slug}", description="Company-wide announcements and general chat", tenant_id=tenant.id, created_by=account.id)
    p3 = Project(name="fun&chat", description="Non-work banter and water cooler chat", tenant_id=tenant.id, created_by=account.id)
    session.add_all([p1, p2, p3])
    
    # 6. Update last_active_tenant_id
    account.last_active_tenant_id = tenant.id
    
    await session.commit()
    
    # 7. Generate JWT
    token = create_access_token(account_id=account.id)
    
    return {
        "access_token": token,
        "token_type": "bearer",
        "account_id": account.id,
        "name": account.name,
        "email": account.email,
        "tenant_id": tenant.id,
        "tenant_name": tenant.name
    }


@app.post("/token", dependencies=[Depends(RateLimiter(limit=5, route_name="login"))], tags=["Auth"])
async def login(
    form_data: OAuth2PasswordRequestForm = Depends(),
    session: AsyncSession = Depends(get_session),
):
    """Login with email + password. Returns a JWT access token.
    
    The token carries: account_id and last_active_tenant_id.
    Use this token in the Authorization header as: Bearer <token>"""
    result = await session.execute(
        select(Account).where(Account.email == form_data.username)
    )
    account = result.scalar_one_or_none()

    if not account or not verify_password(form_data.password, account.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    token = create_access_token(
        account_id=account.id,
    )
    return {"access_token": token, "token_type": "bearer"}


@app.post("/accounts/login", dependencies=[Depends(RateLimiter(limit=5, route_name="login"))], response_model=dict, tags=["Auth"])
async def login_json(
    body: LoginRequest,
    session: AsyncSession = Depends(get_session),
):
    """Login with JSON body {email, password}. Returns a JWT access token.
    Prefer this over the OAuth2 /token endpoint for API clients and frontends."""
    result = await session.execute(
        select(Account).where(Account.email == body.email)
    )
    account = result.scalar_one_or_none()

    if not account or not verify_password(body.password, account.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
        )

    token = create_access_token(
        account_id=account.id,
    )
    return {
        "access_token": token,
        "token_type": "bearer",
        "account_id": account.id,
        "name": account.name,
        "email": account.email,
    }


@app.get("/accounts/me", response_model=dict, tags=["Auth"])
async def get_me(current_account: Account = Depends(get_current_account)):
    """Returns the currently authenticated account's details."""
    return {
        "id": current_account.id,
        "name": current_account.name,
        "email": current_account.email,
        "last_active_tenant_id": current_account.last_active_tenant_id,
    }


class AccountUpdate(BaseModel):
    name: Optional[str] = None
    email: Optional[str] = None


@app.patch("/accounts/me", response_model=dict, tags=["Auth"])
async def update_me(
    body: AccountUpdate,
    request: Request,
    session: AsyncSession = Depends(get_session),
    current_account: Account = Depends(get_current_account),
):
    """Updates the currently authenticated account's details."""
    if body.name is not None:
        current_account.name = body.name
    if body.email is not None:
        new_email = body.email.lower().strip()
        if new_email != current_account.email.lower().strip():
            existing = await session.execute(
                select(Account).where(Account.email == new_email)
            )
            if existing.scalar_one_or_none():
                raise HTTPException(status_code=400, detail="Email already in use.")
            current_account.email = new_email
            
    session.add(current_account)
    await session.commit()
    await session.refresh(current_account)
    
    # Invalidate session cache in Redis
    redis_client = getattr(request.app.state, "arq_pool", None)
    if redis_client:
        from app.dependencies import clear_account_cache
        await clear_account_cache(current_account.id, redis_client)
        
    return {
        "id": current_account.id,
        "name": current_account.name,
        "email": current_account.email,
        "last_active_tenant_id": current_account.last_active_tenant_id,
    }



@app.post("/auth/google-token", dependencies=[Depends(RateLimiter(limit=5, route_name="login"))], response_model=dict, tags=["Auth"])
async def google_auth(
    body: GoogleAuthRequest,
    session: AsyncSession = Depends(get_session),
):
    """Verify a Google access token and return an OmniBase JWT.

    Flow:
      1. Verify the access token with Google's userinfo endpoint securely.
      2. Extract name, email from Google's verified response.
      3. If account with this email already exists → log them in.
      4. If new email → create Account + Tenant + User(Admin) + Project atomically.
      5. Return our JWT (same shape as /auth/signup and /accounts/login).
    """
    # ── 1. Verify Google access token ──────────────────────────────────────
    try:
        req = urllib.request.Request(
            "https://www.googleapis.com/oauth2/v3/userinfo",
            headers={"Authorization": f"Bearer {body.access_token}"}
        )
        with urllib.request.urlopen(req) as response:
            user_info = json.loads(response.read().decode())
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid Google token: {str(e)}",
        )

    google_email: str = user_info.get("email", "").lower().strip()
    google_name: str = user_info.get("name") or google_email.split("@")[0]

    if not google_email:
        raise HTTPException(status_code=400, detail="Google account has no email.")

    # ── 2. Find or create account ──────────────────────────────────────
    existing_result = await session.execute(
        select(Account).where(Account.email == google_email)
    )
    account = existing_result.scalar_one_or_none()

    if account:
        # ── Existing user: just return a fresh JWT ────────────────────────
        token = create_access_token(account_id=account.id)
        return {
            "access_token": token,
            "token_type": "bearer",
            "account_id": account.id,
            "name": account.name,
            "email": account.email,
            "tenant_id": account.last_active_tenant_id,
            "tenant_name": None,   # client can fetch /tenants/ to get the name
            "is_new_user": False,
        }

    # ── New user: provision Account + Tenant + User + Project atomically ──
    account = Account(
        name=google_name,
        email=google_email,
        hashed_password="",   # No password — Google-only account
        last_active_tenant_id=None,
    )
    session.add(account)
    await session.flush()   # get account.id

    tenant_name = f"{google_name}'s Workspace"
    base_slug = re.sub(r'[^a-z0-9]+', '-', tenant_name.lower()).strip('-')
    slug = f"{base_slug}-{account.id}"

    tenant = Tenant(name=tenant_name, slug=slug)
    session.add(tenant)
    await session.flush()   # get tenant.id

    membership = User(account_id=account.id, tenant_id=tenant.id, role="Admin")
    session.add(membership)

    project = Project(
        name="general",
        description="General discussions and updates",
        tenant_id=tenant.id,
        created_by=account.id,
    )
    session.add(project)

    account.last_active_tenant_id = tenant.id
    await session.commit()

    token = create_access_token(account_id=account.id)
    return {
        "access_token": token,
        "token_type": "bearer",
        "account_id": account.id,
        "name": account.name,
        "email": account.email,
        "tenant_id": tenant.id,
        "tenant_name": tenant.name,
        "is_new_user": True,
    }

# ─────────────────────────────────────────────────────────────────────────────
# INVITES AND CONTACTS
# ─────────────────────────────────────────────────────────────────────────────

import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

class InviteRequest(BaseModel):
    emails: list[str]
    workspace_name: str
    base_url: str = "https://omnibase.onrender.com"

@app.post("/api/invite", tags=["Invites"])
async def send_invites(
    body: InviteRequest,
    request: Request,
    session: AsyncSession = Depends(get_session),
    membership: User = Depends(get_verified_membership),
    current_account: Account = Depends(get_current_account),
):
    gmail_user = os.getenv("GMAIL_ADDRESS")
    gmail_password = os.getenv("GMAIL_APP_PASSWORD")
    mail_server = os.getenv("MAIL_SERVER", "smtp.gmail.com")
    mail_port = int(os.getenv("MAIL_PORT", 587))

    if not gmail_user or not gmail_password:
        raise HTTPException(status_code=500, detail="Email configuration missing in .env")

    success_count = 0
    errors = []

    for recipient in body.emails:
        try:
            # 1. Save invitation to database
            inv_result = await session.execute(
                select(Invitation).where(
                    Invitation.email == recipient, 
                    Invitation.tenant_id == membership.tenant_id
                )
            )
            existing_invitation = inv_result.scalars().first()
            if not existing_invitation:
                invitation = Invitation(
                    email=recipient,
                    tenant_id=membership.tenant_id,
                    invited_by=membership.account_id
                )
                session.add(invitation)
                await session.commit()
            
            # 2. Send WebSocket notification if user is online
            acc_result = await session.execute(select(Account).where(Account.email == recipient))
            invited_account = acc_result.scalars().first()
            if invited_account:
                await ws_manager.personal_broadcast({
                    "type": "INVITE_RECEIVED",
                    "workspace_name": body.workspace_name,
                    "invited_by": current_account.name
                }, invited_account.id)

            # 3. Send Email (via ARQ worker or local synchronous fallback)
            safe_ws = urllib.parse.quote(body.workspace_name)
            safe_email = urllib.parse.quote(recipient)
            invite_url = f"{body.base_url}/signup?ws={safe_ws}&email={safe_email}"

            arq_pool = getattr(request.app.state, "arq_pool", None)
            if arq_pool:
                await arq_pool.enqueue_job("send_invite_email", recipient, body.workspace_name, invite_url)
                print(f"Enqueued background task to send invite to {recipient}")
                success_count += 1
            else:
                msg = MIMEMultipart()
                msg['From'] = gmail_user
                msg['To'] = recipient
                msg['Subject'] = f"OmniBase: You've been invited to join the {body.workspace_name} workspace"

                html = f"""
                <html>
                  <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
                    <h2 style="color: #2dd4bf;">Welcome to OmniBase</h2>
                    <p>Hello,</p>
                    <p>An engineer has invited you to collaborate on the <strong>{body.workspace_name}</strong> workspace inside OmniBase—a high-performance, real-time developer collaboration cluster.</p>
                    <p>By joining this workspace, you will gain instant access to live team channels, automated project resource boards, and integrated AI assistant utilities built directly into your communication streams.</p>
                    <div style="margin: 30px 0;">
                      <a href="{invite_url}" style="background-color: #3b82f6; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">Accept Invitation & Join Team</a>
                    </div>
                    <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;" />
                    <p style="font-size: 12px; color: #999;">Security Note: This invitation token expires in 48 hours.</p>
                  </body>
                </html>
                """
                
                msg.attach(MIMEText(html, 'html'))

                server = smtplib.SMTP(mail_server, mail_port)
                server.starttls()
                server.login(gmail_user, gmail_password)
                server.send_message(msg)
                server.quit()
                print(f"Sent invite synchronously to {recipient}")
                success_count += 1
        except Exception as e:
            errors.append(f"Failed for {recipient}: {str(e)}")

    if errors:
        if success_count == 0:
            raise HTTPException(status_code=500, detail="Failed to send any emails: " + ", ".join(errors))
        return {"message": f"Sent {success_count} invites, but {len(errors)} failed.", "errors": errors}

    return {"message": f"Successfully sent {success_count} invites"}

class AcceptInviteRequest(BaseModel):
    workspace_name: str

@app.post("/api/invite/accept", tags=["Invites"])
async def accept_invite(
    body: AcceptInviteRequest,
    session: AsyncSession = Depends(get_session),
    current_account: Account = Depends(get_current_account),
):
    # Find tenant by name
    t_result = await session.execute(select(Tenant).where(Tenant.name == body.workspace_name))
    tenant = t_result.scalars().first()
    if not tenant:
        raise HTTPException(status_code=404, detail="Workspace not found")

    # Check if user is already a member
    u_result = await session.execute(
        select(User).where(User.account_id == current_account.id, User.tenant_id == tenant.id)
    )
    user = u_result.scalars().first()
    
    if not user:
        # Create user role
        user = User(
            account_id=current_account.id,
            tenant_id=tenant.id,
            role=UserRole.user
        )
        session.add(user)
        await session.commit()
    
    # Mark invitation as accepted if it exists
    inv_result = await session.execute(
        select(Invitation).where(
            Invitation.email == current_account.email, 
            Invitation.tenant_id == tenant.id,
            Invitation.status == "pending"
        )
    )
    invitation = inv_result.scalars().first()
    if invitation:
        invitation.status = "accepted"
        session.add(invitation)
        await session.commit()
        
    return {"message": "Successfully joined workspace", "tenant_id": tenant.id}


class GoogleContactsRequest(BaseModel):
    access_token: str

@app.post("/api/auth/google-contacts", tags=["Auth"])
async def fetch_google_contacts(
    body: GoogleContactsRequest,
):
    try:
        req = urllib.request.Request(
            "https://people.googleapis.com/v1/people/me/connections?personFields=names,emailAddresses",
            headers={"Authorization": f"Bearer {body.access_token}"}
        )
        with urllib.request.urlopen(req) as response:
            data = json.loads(response.read().decode())
            
        contacts = []
        for person in data.get("connections", []):
            names = person.get("names", [])
            emails = person.get("emailAddresses", [])
            if emails:
                name = names[0].get("displayName") if names else emails[0].get("value")
                email = emails[0].get("value")
                contacts.append({"name": name, "email": email})
                
        return {"contacts": contacts}
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Failed to fetch Google contacts: {str(e)}",
        )


# ─────────────────────────────────────────────────────────────────────────────
# TENANTS — Protected by auth + tenant context
# ─────────────────────────────────────────────────────────────────────────────

@app.post("/tenants/", response_model=Tenant, tags=["Tenants"])
async def create_tenant(
    tenant_in: TenantCreate,
    request: Request,
    session: AsyncSession = Depends(get_session),
    current_account: Account = Depends(get_current_account),
):
    """Create a new Tenant (workspace). Automatically sets it as the
    caller's last_active_tenant_id and creates a User record with role=Admin."""
    # Create the tenant
    tenant = Tenant.model_validate(tenant_in)
    session.add(tenant)
    await session.flush()  # get tenant.id before committing

    # Add caller as Admin of this new tenant
    membership = User(
        account_id=current_account.id,
        tenant_id=tenant.id,
        role="Admin",
    )
    session.add(membership)

    # Set this as their active tenant
    current_account.last_active_tenant_id = tenant.id
    session.add(current_account)

    await session.commit()
    await session.refresh(tenant)

    # Clear account session cache so the new last_active_tenant_id takes effect
    redis_client = getattr(request.app.state, "arq_pool", None)
    await clear_account_cache(current_account.id, redis_client)

    return tenant


@app.get("/tenants/", response_model=list[Tenant], tags=["Tenants"])
async def get_my_tenants(
    session: AsyncSession = Depends(get_session),
    current_account: Account = Depends(get_current_account),
):
    """Returns only the tenants this account is a member of."""
    result = await session.execute(
        select(Tenant)
        .join(User, User.tenant_id == Tenant.id)
        .where(User.account_id == current_account.id)
    )
    return list(result.scalars().all())


@app.post("/api/tenants/{tenant_id}/select", tags=["Tenants"])
async def select_tenant(
    tenant_id: int,
    request: Request,
    session: AsyncSession = Depends(get_session),
    current_account: Account = Depends(get_current_account),
):
    # Verify membership
    result = await session.execute(
        select(User).where(User.account_id == current_account.id, User.tenant_id == tenant_id)
    )
    membership = result.scalar_one_or_none()
    if not membership:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not a member of this workspace."
        )

    current_account.last_active_tenant_id = tenant_id
    session.add(current_account)
    await session.commit()

    # Clear account session cache so the updated last_active_tenant_id takes effect
    redis_client = getattr(request.app.state, "arq_pool", None)
    await clear_account_cache(current_account.id, redis_client)

    return {"message": "Active tenant updated successfully", "tenant_id": tenant_id}


# ─────────────────────────────────────────────────────────────────────────────
# USERS (Memberships) — Scoped to active tenant
# ─────────────────────────────────────────────────────────────────────────────

@app.post("/users/", response_model=User, tags=["Users"])
async def add_member(
    user_in: UserCreate,
    session: AsyncSession = Depends(get_session),
    membership: User = Depends(get_verified_membership),
):
    """Add an existing Account as a member of the current active tenant.
    Caller must already be a verified member of the active tenant."""
    user = User.model_validate(user_in)
    session.add(user)
    await session.commit()
    await session.refresh(user)
    return user


@app.get("/users/", response_model=list[dict], tags=["Users"])
async def get_members(
    session: AsyncSession = Depends(get_session),
    membership: User = Depends(get_verified_membership),
):
    """Returns all members of the current active tenant ONLY.
    Privacy Wall: only members of this tenant can see its member list."""
    result = await session.execute(
        select(User, Account)
        .join(Account, User.account_id == Account.id)
        .where(User.tenant_id == membership.tenant_id)
    )
    members = []
    for user, account in result.all():
        members.append({
            "id": user.id,
            "account_id": user.account_id,
            "tenant_id": user.tenant_id,
            "role": user.role,
            "name": account.name,
            "email": account.email
        })
    return members


# ─────────────────────────────────────────────────────────────────────────────
# PROJECTS — Tenant-scoped with Privacy Wall + role-based deletion
# ─────────────────────────────────────────────────────────────────────────────

@app.post("/projects/", response_model=ProjectRead, tags=["Projects"])
async def create_project(
    project_in: ProjectCreate,
    session: AsyncSession = Depends(get_session),
    membership: User = Depends(get_verified_membership),   # ← Privacy Wall
):
    """Create a project inside the caller's currently active tenant.

    tenant_id and created_by are injected from the verified membership —
    the caller cannot forge these values."""
    project = Project(
        name=project_in.name,
        description=project_in.description,
        tenant_id=membership.tenant_id,       # locked to active tenant
        created_by=membership.account_id,     # locked to this account
        is_private=project_in.is_private,
    )
    session.add(project)
    await session.commit()
    await session.refresh(project)

    if project.is_private:
        # Creator is the Admin of the private channel
        member = ProjectMember(
            project_id=project.id,
            account_id=membership.account_id,
            role=ChannelRole.admin
        )
        session.add(member)
        await session.commit()

    return project


@app.get("/projects/", response_model=list[ProjectRead], tags=["Projects"])
async def list_projects(
    session: AsyncSession = Depends(get_session),
    membership: User = Depends(get_verified_membership),   # ← Privacy Wall
):
    """List projects visible to the caller:
      - All public channels (is_private=False) belonging to the active tenant.
      - All private DM rooms (is_private=True) where the caller is a ProjectMember.
    Private rooms of other users in the same tenant stay invisible."""
    # 1. Public channels in this tenant
    public_result = await session.execute(
        select(Project).where(
            Project.tenant_id == membership.tenant_id,
            Project.is_private == False,  # noqa: E712
        )
    )
    public_projects = list(public_result.scalars().all())

    # 2. Private DM rooms where the caller is an explicit member
    dm_result = await session.execute(
        select(Project)
        .join(ProjectMember, ProjectMember.project_id == Project.id)
        .where(
            Project.tenant_id == membership.tenant_id,
            Project.is_private == True,  # noqa: E712
            ProjectMember.account_id == membership.account_id,
        )
    )
    dm_projects = list(dm_result.scalars().all())

    return public_projects + dm_projects


@app.get("/projects/unread-states", tags=["Projects"])
async def get_unread_states(
    session: AsyncSession = Depends(get_session),
    membership: User = Depends(get_verified_membership),
):
    """Returns a map of {project_id: unread_count} for the active tenant.
    
    IMPORTANT: This route MUST be defined before any /projects/{project_id}/...
    routes so FastAPI matches the literal 'unread-states' string instead of
    trying to parse it as an integer project_id.
    """
    from sqlalchemy import func
    # 1. Get user's read states
    states_result = await session.execute(
        select(UserProjectState).where(UserProjectState.account_id == membership.account_id)
    )
    states = {s.project_id: s.last_read_message_id for s in states_result.scalars().all()}
    
    # 2. Get all projects the user has access to in this tenant
    public_result = await session.execute(
        select(Project.id).where(
            Project.tenant_id == membership.tenant_id,
            Project.is_private == False,
        )
    )
    public_pids = list(public_result.scalars().all())

    dm_result = await session.execute(
        select(Project.id)
        .join(ProjectMember, ProjectMember.project_id == Project.id)
        .where(
            Project.tenant_id == membership.tenant_id,
            Project.is_private == True,
            ProjectMember.account_id == membership.account_id,
        )
    )
    dm_pids = list(dm_result.scalars().all())
    
    all_pids = public_pids + dm_pids
    if not all_pids:
        return {}
        
    # 3. Count unread messages per project (messages after last_read that weren't sent by current user)
    counts_result = await session.execute(
        select(Message.project_id, func.count(Message.id), func.max(Message.id))
        .where(Message.project_id.in_(all_pids))
        .group_by(Message.project_id)
    )
    
    unread_map = {}
    for pid, total_msgs, max_id in counts_result.all():
        last_read = states.get(pid, 0) or 0
        if last_read < max_id:
            unread_msgs_result = await session.execute(
                select(func.count(Message.id))
                .where(
                    Message.project_id == pid,
                    Message.id > last_read,
                    Message.account_id != membership.account_id
                )
            )
            unread_map[pid] = unread_msgs_result.scalar_one_or_none() or 0
        else:
            unread_map[pid] = 0
            
    return unread_map


@app.get("/projects/{project_id}/members", tags=["Projects"])
async def get_project_members(
    project_id: int,
    session: AsyncSession = Depends(get_session),
    membership: User = Depends(get_verified_membership),
):
    p_result = await session.execute(select(Project).where(Project.id == project_id, Project.tenant_id == membership.tenant_id))
    project = p_result.scalars().first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
        
    m_result = await session.execute(
        select(ProjectMember, Account)
        .join(Account, Account.id == ProjectMember.account_id)
        .where(ProjectMember.project_id == project_id)
    )
    members = []
    for pm, acc in m_result.all():
        members.append({
            "account_id": acc.id,
            "name": acc.name,
            "email": acc.email,
            "role": pm.role.value
        })
    return members

class AddProjectMemberRequest(BaseModel):
    account_id: int

@app.post("/projects/{project_id}/members", tags=["Projects"])
async def add_project_member(
    project_id: int,
    body: AddProjectMemberRequest,
    session: AsyncSession = Depends(get_session),
    membership: User = Depends(get_verified_membership),
):
    p_result = await session.execute(select(Project).where(Project.id == project_id, Project.tenant_id == membership.tenant_id))
    project = p_result.scalars().first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    caller_pm_result = await session.execute(select(ProjectMember).where(ProjectMember.project_id == project_id, ProjectMember.account_id == membership.account_id))
    caller_pm = caller_pm_result.scalars().first()
    
    if not caller_pm or caller_pm.role == ChannelRole.member:
        raise HTTPException(status_code=403, detail="Only Admins and Elders can add members")

    new_member = ProjectMember(
        project_id=project_id,
        account_id=body.account_id,
        role=ChannelRole.member
    )
    session.add(new_member)
    try:
        await session.commit()
    except Exception:
        await session.rollback()
        raise HTTPException(status_code=400, detail="User is already in the channel")
        
    return {"message": "Member added successfully"}

class UpdateRoleRequest(BaseModel):
    role: ChannelRole

@app.patch("/projects/{project_id}/members/{account_id}/role", tags=["Projects"])
async def update_project_member_role(
    project_id: int,
    account_id: int,
    body: UpdateRoleRequest,
    session: AsyncSession = Depends(get_session),
    membership: User = Depends(get_verified_membership),
):
    caller_pm_result = await session.execute(select(ProjectMember).where(ProjectMember.project_id == project_id, ProjectMember.account_id == membership.account_id))
    caller_pm = caller_pm_result.scalars().first()
    if not caller_pm:
        raise HTTPException(status_code=403, detail="Not a member of this project")

    target_pm_result = await session.execute(select(ProjectMember).where(ProjectMember.project_id == project_id, ProjectMember.account_id == account_id))
    target_pm = target_pm_result.scalars().first()
    if not target_pm:
        raise HTTPException(status_code=404, detail="Member not found in this project")

    if caller_pm.role == ChannelRole.member:
        raise HTTPException(status_code=403, detail="Members cannot change roles")

    if body.role == ChannelRole.admin and caller_pm.role != ChannelRole.admin:
        raise HTTPException(status_code=403, detail="Only an Admin can promote to Admin")

    if target_pm.role == ChannelRole.admin and caller_pm.role != ChannelRole.admin:
        raise HTTPException(status_code=403, detail="Only an Admin can demote an Admin")
        
    if account_id == membership.account_id and body.role != ChannelRole.admin:
        admin_count_result = await session.execute(select(ProjectMember).where(ProjectMember.project_id == project_id, ProjectMember.role == ChannelRole.admin))
        admin_count = len(admin_count_result.scalars().all())
        if admin_count <= 1:
            raise HTTPException(status_code=400, detail="Cannot demote yourself. You are the only Admin.")

    target_pm.role = body.role
    session.add(target_pm)
    
    # Send a notification for role change
    notif = Notification(
        user_id=account_id,
        actor_id=membership.account_id,
        type="role_escalation",
        project_id=project_id,
        content_preview=f"Your role in the channel was updated to {body.role.value}"
    )
    session.add(notif)
    
    await session.commit()
    
    # Broadcast notification personally
    await ws_manager.personal_broadcast({
        "type": "NOTIFICATION",
        "notification": {
            "id": notif.id,
            "type": notif.type,
            "content_preview": notif.content_preview,
            "project_id": notif.project_id
        }
    }, account_id)
    
    return {"message": "Role updated successfully"}

@app.delete("/projects/{project_id}/members/{account_id}", tags=["Projects"])
async def remove_project_member(
    project_id: int,
    account_id: int,
    session: AsyncSession = Depends(get_session),
    membership: User = Depends(get_verified_membership),
):
    caller_pm_result = await session.execute(select(ProjectMember).where(ProjectMember.project_id == project_id, ProjectMember.account_id == membership.account_id))
    caller_pm = caller_pm_result.scalars().first()
    
    if not caller_pm or caller_pm.role != ChannelRole.admin:
        raise HTTPException(status_code=403, detail="Only Admins can kick members")

    if account_id == membership.account_id:
        raise HTTPException(status_code=400, detail="Cannot kick yourself. Use leave channel instead or demote.")

    target_pm_result = await session.execute(select(ProjectMember).where(ProjectMember.project_id == project_id, ProjectMember.account_id == account_id))
    target_pm = target_pm_result.scalars().first()
    
    if not target_pm:
        raise HTTPException(status_code=404, detail="Member not found")

    await session.delete(target_pm)
    await session.commit()
    return {"message": "Member removed successfully"}


class DMRequest(BaseModel):
    """Request body for creating or retrieving a DM conversation."""
    target_account_id: int  # the account_id of the other user (same as caller for self-DM)


@app.post("/projects/dm", response_model=ProjectRead, tags=["Projects"])
async def get_or_create_dm(
    body: DMRequest,
    session: AsyncSession = Depends(get_session),
    membership: User = Depends(get_verified_membership),
):
    """Return (or create) the private DM project between the caller and target.

    Rules:
      - Self-DM: target_account_id == caller's account_id → one-person private room.
      - 1:1 DM: finds an existing shared private project; creates one if absent.
      - The target_account_id must be a member of the same active tenant (Privacy Wall).
    """
    caller_id = membership.account_id
    target_id = body.target_account_id

    # ── Privacy Wall: target must be in the same tenant ───────────────────────
    if target_id != caller_id:
        target_check = await session.execute(
            select(User).where(
                User.account_id == target_id,
                User.tenant_id == membership.tenant_id,
            )
        )
        if target_check.scalar_one_or_none() is None:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Target user is not a member of your workspace.",
            )

    # ── Find existing DM project between these two accounts ───────────────────
    if target_id == caller_id:
        # Self-DM: a private project where only the caller is a member
        existing = await session.execute(
            select(Project)
            .join(ProjectMember, ProjectMember.project_id == Project.id)
            .where(
                Project.tenant_id == membership.tenant_id,
                Project.type == "dm",
                Project.is_private == True,  # noqa: E712
                ProjectMember.account_id == caller_id,
            )
        )
        # Filter to projects with ONLY the caller as member (true self-DM)
        candidates = existing.scalars().all()
        existing_project = None
        for p in candidates:
            # Verify it's truly a self-DM (only one member: the caller)
            members_res = await session.execute(
                select(ProjectMember).where(ProjectMember.project_id == p.id)
            )
            members = members_res.scalars().all()
            account_ids = {m.account_id for m in members}
            if account_ids == {caller_id}:
                existing_project = p
                break
    else:
        # 1:1 DM: find a private project where BOTH accounts are members
        # Sub-query: project IDs where caller is a member
        caller_pids = select(ProjectMember.project_id).where(
            ProjectMember.account_id == caller_id
        ).scalar_subquery()
        # Sub-query: project IDs where target is a member
        target_pids = select(ProjectMember.project_id).where(
            ProjectMember.account_id == target_id
        ).scalar_subquery()

        existing = await session.execute(
            select(Project).where(
                Project.tenant_id == membership.tenant_id,
                Project.type == "dm",
                Project.is_private == True,  # noqa: E712
                Project.id.in_(caller_pids),
                Project.id.in_(target_pids),
            )
        )
        candidates = existing.scalars().all()
        existing_project = None
        for p in candidates:
            # Confirm exactly two members (no stray group rooms)
            members_res = await session.execute(
                select(ProjectMember).where(ProjectMember.project_id == p.id)
            )
            members = members_res.scalars().all()
            account_ids = {m.account_id for m in members}
            if account_ids == {caller_id, target_id}:
                existing_project = p
                break

    if existing_project:
        return existing_project

    # ── Create new private DM project ─────────────────────────────────────────
    # Build a deterministic name that doesn't reveal anything to outsiders
    dm_name = f"dm-{min(caller_id, target_id)}-{max(caller_id, target_id)}"
    if target_id == caller_id:
        dm_name = f"dm-self-{caller_id}"

    project = Project(
        name=dm_name,
        description="Direct Message",
        tenant_id=membership.tenant_id,
        created_by=caller_id,
        type="dm",
        is_private=True,
    )
    session.add(project)
    await session.flush()  # get project.id

    # Add caller as a member
    session.add(ProjectMember(project_id=project.id, account_id=caller_id))
    # Add target as a member only if it's not a self-DM
    if target_id != caller_id:
        session.add(ProjectMember(project_id=project.id, account_id=target_id))

    await session.commit()
    await session.refresh(project)
    return project


@app.delete("/projects/{project_id}", response_model=dict, tags=["Projects"])
async def delete_project(
    project_id: int,
    session: AsyncSession = Depends(get_session),
    membership: User = Depends(get_verified_membership),   # ← Privacy Wall
):
    """Delete a project. Rules:
      1. Project must belong to the caller's active tenant.
      2. Caller must have role Admin OR Manager — plain User is rejected."""
    # Role check — only Admin and Manager can delete
    if membership.role not in ("Admin", "Manager"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only Admins and Managers can delete projects.",
        )

    # Fetch the project, but ONLY within this tenant (prevents cross-tenant delete)
    result = await session.execute(
        select(Project).where(
            Project.id == project_id,
            Project.tenant_id == membership.tenant_id,   # ← cross-tenant guard
        )
    )
    project = result.scalar_one_or_none()

    if project is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found in your active tenant.",
        )

    await session.delete(project)
    await session.commit()
    return {"message": f"Project '{project.name}' deleted successfully."}


async def clear_message_cache(project_id: int, redis_client) -> None:
    """Scan and delete all cached message history variants for a project room to invalidate cache."""
    if not redis_client:
        return
    try:
        pattern = f"messages:project_id:{project_id}:*"
        keys = []
        cur = b"0"
        while cur:
            cur, chunk = await redis_client.scan(cur, match=pattern, count=100)
            keys.extend(chunk)
        if keys:
            await redis_client.delete(*keys)
            print(f"Cache Invalidation: Deleted {len(keys)} cache keys matching {pattern}")
    except Exception as e:
        print(f"Error invalidating message cache for project {project_id}: {e}")


# ─────────────────────────────────────────────────────────────────────────────
# MESSAGES — REST history + WebSocket real-time
# ─────────────────────────────────────────────────────────────────────────────

@app.get("/projects/{project_id}/messages", response_model=list[MessageRead], tags=["Messages"])
async def get_message_history(
    project_id: int,
    request: Request,
    limit: int = 50,
    session: AsyncSession = Depends(get_session),
    membership: User = Depends(get_verified_membership),
):
    """Return the last `limit` messages for a channel, newest at the bottom.

    Privacy wall (layered):
      1. The project must belong to the caller's active tenant.
      2. If the project is private (DM), the caller must be a ProjectMember.
    """
    # ── Check Cache First ─────────────────────────────────────────────────────
    redis_client = getattr(request.app.state, "arq_pool", None)
    cache_key = f"messages:project_id:{project_id}:limit:{limit}"
    if redis_client:
        try:
            cached_val = await redis_client.get(cache_key)
            if cached_val:
                print(f"Cache Hit: Loaded messages for project {project_id} (limit {limit}) from Redis.")
                data = json.loads(cached_val)
                return [MessageRead.model_validate(m) for m in data]
        except Exception as e:
            print(f"Redis Cache GET exception: {e}")

    # Layer 1: tenant scope
    proj_result = await session.execute(
        select(Project).where(
            Project.id == project_id,
            Project.tenant_id == membership.tenant_id,
        )
    )
    project = proj_result.scalar_one_or_none()
    if project is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Channel not found in your workspace.",
        )

    # Layer 2: private DM access check
    if project.is_private:
        pm_result = await session.execute(
            select(ProjectMember).where(
                ProjectMember.project_id == project_id,
                ProjectMember.account_id == membership.account_id,
            )
        )
        if pm_result.scalar_one_or_none() is None:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You do not have access to this private conversation.",
            )

    # Fetch last N messages joined with the account name
    from sqlalchemy import or_
    result = await session.execute(
        select(Message, Account)
        .join(Account, Message.account_id == Account.id)
        .where(
            Message.project_id == project_id,
            or_(Message.file_type != "reaction_bump", Message.file_type.is_(None))
        )
        .order_by(Message.created_at.asc())
        .limit(limit)
    )

    msg_records = result.all()
    message_ids = [msg.id for msg, account in msg_records]

    # Fetch all reactions for these messages
    reactions_dict = {msg_id: [] for msg_id in message_ids}
    if message_ids:
        react_result = await session.execute(
            select(Reaction, Account)
            .join(Account, Reaction.account_id == Account.id)
            .where(Reaction.message_id.in_(message_ids))
        )
        for reaction, acc in react_result.all():
            reactions_dict[reaction.message_id].append({
                "id": reaction.id,
                "emoji": reaction.emoji,
                "account_id": reaction.account_id,
                "sender_name": acc.name
            })

    messages = []
    for msg, account in msg_records:
        messages.append(MessageRead(
            id=msg.id,
            content=msg.content,
            file_url=msg.file_url,
            file_type=msg.file_type,
            created_at=msg.created_at,
            project_id=msg.project_id,
            account_id=msg.account_id,
            sender_name=account.name,
            is_pinned=msg.is_pinned,
            is_edited=msg.is_edited,
            reactions=reactions_dict[msg.id],
            parent_id=msg.parent_id
        ))

    # ── Populate Cache ────────────────────────────────────────────────────────
    if redis_client:
        try:
            cache_payload = [m.model_dump(mode="json") for m in messages]
            await redis_client.setex(cache_key, 300, json.dumps(cache_payload))
            print(f"Cache Miss: Saved messages for project {project_id} (limit {limit}) to Redis.")
        except Exception as e:
            print(f"Redis Cache SET exception: {e}")

    return messages



class MessageEditRequest(BaseModel):
    content: str

@app.patch("/projects/{project_id}/messages/{message_id}", response_model=MessageRead, tags=["Messages"])
async def edit_message(
    project_id: int,
    message_id: int,
    body: MessageEditRequest,
    request: Request,
    session: AsyncSession = Depends(get_session),
    membership: User = Depends(get_verified_membership),
    current_account: Account = Depends(get_current_account),
):
    msg_result = await session.execute(
        select(Message).where(Message.id == message_id, Message.project_id == project_id)
    )
    msg = msg_result.scalar_one_or_none()
    if not msg:
        raise HTTPException(status_code=404, detail="Message not found")
        
    if msg.account_id != current_account.id:
        raise HTTPException(status_code=403, detail="You can only edit your own messages")

    msg.content = body.content
    msg.is_edited = True
    session.add(msg)
    await session.commit()
    
    # Invalidate messages cache for this project
    redis_client = getattr(request.app.state, "arq_pool", None)
    await clear_message_cache(project_id, redis_client)
    
    await ws_manager.broadcast_to_project(project_id, {
        "type": "MESSAGE_EDITED",
        "message_id": msg.id,
        "content": msg.content,
        "project_id": project_id
    })
    
    return MessageRead(
        id=msg.id,
        content=msg.content,
        file_url=msg.file_url,
        file_type=msg.file_type,
        created_at=msg.created_at,
        project_id=msg.project_id,
        account_id=msg.account_id,
        sender_name=current_account.name,
        is_pinned=msg.is_pinned,
        is_edited=msg.is_edited,
        reactions=[],
        parent_id=msg.parent_id
    )

@app.delete("/projects/{project_id}/messages/{message_id}", tags=["Messages"])
async def delete_message(
    project_id: int,
    message_id: int,
    request: Request,
    session: AsyncSession = Depends(get_session),
    membership: User = Depends(get_verified_membership),
    current_account: Account = Depends(get_current_account),
):
    msg_result = await session.execute(
        select(Message).where(Message.id == message_id, Message.project_id == project_id)
    )
    msg = msg_result.scalar_one_or_none()
    if not msg:
        raise HTTPException(status_code=404, detail="Message not found")
        
    if msg.account_id != current_account.id:
        raise HTTPException(status_code=403, detail="You can only delete your own messages")

    # 1. Delete child messages (replies and reaction bumps) to prevent ForeignKeyViolations and clean DB
    child_ids_result = await session.execute(
        select(Message.id).where(Message.parent_id == message_id)
    )
    child_ids = list(child_ids_result.scalars().all())
    if child_ids:
        # Delete reactions for child messages
        await session.execute(
            delete(Reaction).where(Reaction.message_id.in_(child_ids))
        )
        # Delete notifications for child messages
        await session.execute(
            delete(Notification).where(Notification.message_id.in_(child_ids))
        )
        # Update read states pointing to child messages
        await session.execute(
            update(UserProjectState)
            .where(UserProjectState.last_read_message_id.in_(child_ids))
            .values(last_read_message_id=None)
        )
        # Delete child messages themselves
        await session.execute(
            delete(Message).where(Message.id.in_(child_ids))
        )

    # 2. Delete associated reactions
    await session.execute(
        delete(Reaction).where(Reaction.message_id == message_id)
    )

    # 3. Delete associated notifications
    await session.execute(
        delete(Notification).where(Notification.message_id == message_id)
    )

    # 4. Update read states pointing to this message
    await session.execute(
        update(UserProjectState)
        .where(UserProjectState.last_read_message_id == message_id)
        .values(last_read_message_id=None)
    )

    # 5. Delete the message itself
    await session.delete(msg)
    await session.commit()
    
    # Invalidate messages cache for this project
    redis_client = getattr(request.app.state, "arq_pool", None)
    await clear_message_cache(project_id, redis_client)
    
    # Broadcast deletion to all project members
    await ws_manager.broadcast_to_project(project_id, {
        "type": "MESSAGE_DELETED",
        "message_id": message_id,
        "project_id": project_id
    })
    
    return {"message": "Message deleted successfully"}

@app.post("/projects/{project_id}/messages/{message_id}/pin", tags=["Messages"])
async def toggle_pin_message(
    project_id: int,
    message_id: int,
    request: Request,
    session: AsyncSession = Depends(get_session),
    membership: User = Depends(get_verified_membership),
):
    msg_result = await session.execute(
        select(Message).where(Message.id == message_id, Message.project_id == project_id)
    )
    msg = msg_result.scalar_one_or_none()
    if not msg:
        raise HTTPException(status_code=404, detail="Message not found")
        
    msg.is_pinned = not msg.is_pinned
    session.add(msg)
    await session.commit()
    
    # Invalidate messages cache for this project
    redis_client = getattr(request.app.state, "arq_pool", None)
    await clear_message_cache(project_id, redis_client)
    
    await ws_manager.broadcast_to_project(project_id, {
        "type": "MESSAGE_PINNED",
        "message_id": msg.id,
        "is_pinned": msg.is_pinned,
        "project_id": project_id
    })
    
    return {"message": "Message pin toggled", "is_pinned": msg.is_pinned}

class ReactionRequest(BaseModel):
    emoji: str

@app.post("/projects/{project_id}/messages/{message_id}/react", tags=["Messages"])
async def toggle_reaction(
    project_id: int,
    message_id: int,
    body: ReactionRequest,
    request: Request,
    session: AsyncSession = Depends(get_session),
    membership: User = Depends(get_verified_membership),
    current_account: Account = Depends(get_current_account),
):
    msg_result = await session.execute(
        select(Message).where(Message.id == message_id, Message.project_id == project_id)
    )
    msg = msg_result.scalar_one_or_none()
    if not msg:
        raise HTTPException(status_code=404, detail="Message not found")
        
    react_result = await session.execute(
        select(Reaction).where(
            Reaction.message_id == message_id,
            Reaction.account_id == current_account.id,
            Reaction.emoji == body.emoji
        )
    )
    existing = react_result.scalar_one_or_none()
    
    if existing:
        await session.delete(existing)
        action = "removed"
        # Delete any associated reaction_bump message automatically
        await session.execute(
            delete(Message).where(
                Message.project_id == project_id,
                Message.account_id == current_account.id,
                Message.parent_id == message_id,
                Message.file_type == "reaction_bump",
                Message.content == f"User reacted with {body.emoji}"
            )
        )
        bump_msg = None
    else:
        new_react = Reaction(
            message_id=message_id,
            account_id=current_account.id,
            emoji=body.emoji
        )
        session.add(new_react)
        action = "added"
        # Create the reaction_bump message automatically, linking it via parent_id
        bump_msg = Message(
            project_id=project_id,
            account_id=current_account.id,
            content=f"User reacted with {body.emoji}",
            file_type="reaction_bump",
            parent_id=message_id
        )
        session.add(bump_msg)
        
    await session.commit()
    if bump_msg:
        await session.refresh(bump_msg)
        
    # Invalidate messages cache for this project
    redis_client = getattr(request.app.state, "arq_pool", None)
    await clear_message_cache(project_id, redis_client)
    
    all_reacts = await session.execute(
        select(Reaction, Account)
        .join(Account, Reaction.account_id == Account.id)
        .where(Reaction.message_id == message_id)
    )
    reactions_list = [{
        "id": r.id,
        "emoji": r.emoji,
        "account_id": r.account_id,
        "sender_name": a.name
    } for r, a in all_reacts.all()]
    
    await ws_manager.broadcast_to_project(project_id, {
        "type": "REACTION_UPDATED",
        "message_id": message_id,
        "reactions": reactions_list,
        "project_id": project_id
    })

    if action == "added" and bump_msg:
        # We broadcast the bump message but tell the frontend it's a reaction bump
        await ws_manager.broadcast_to_project(project_id, {
            "type": "NEW_MESSAGE",
            "message": {
                "id": bump_msg.id,
                "project_id": project_id,
                "content": bump_msg.content,
                "account_id": current_account.id,
                "sender_name": current_account.name,
                "created_at": bump_msg.created_at.isoformat(),
                "is_reaction_bump": True
            }
        })
    
    return {"message": f"Reaction {action}", "reactions": reactions_list}

@app.post("/projects/{project_id}/read", tags=["Projects"])
async def mark_channel_read(
    project_id: int,
    session: AsyncSession = Depends(get_session),
    membership: User = Depends(get_verified_membership),
):
    """Mark all messages in the channel as read by the current user."""
    # Find the latest message in this channel
    latest_msg_result = await session.execute(
        select(Message.id).where(Message.project_id == project_id).order_by(Message.id.desc()).limit(1)
    )
    latest_msg_id = latest_msg_result.scalar_one_or_none()
    if not latest_msg_id:
        return {"message": "No messages to read"}

    # Update or create UserProjectState
    state_result = await session.execute(
        select(UserProjectState).where(
            UserProjectState.project_id == project_id,
            UserProjectState.account_id == membership.account_id
        )
    )
    state = state_result.scalar_one_or_none()
    
    if state:
        state.last_read_message_id = latest_msg_id
    else:
        state = UserProjectState(
            account_id=membership.account_id,
            project_id=project_id,
            last_read_message_id=latest_msg_id
        )
        session.add(state)
        
    await session.commit()
    return {"message": "Read receipt updated"}



@app.get("/notifications", tags=["Notifications"])
async def get_notifications(
    session: AsyncSession = Depends(get_session),
    current_account: Account = Depends(get_current_account),
):
    result = await session.execute(
        select(Notification)
        .where(Notification.user_id == current_account.id)
        .order_by(Notification.created_at.desc())
        .limit(50)
    )
    return result.scalars().all()


@app.post("/notifications/{notification_id}/read", tags=["Notifications"])
async def mark_notification_read(
    notification_id: int,
    session: AsyncSession = Depends(get_session),
    current_account: Account = Depends(get_current_account),
):
    result = await session.execute(
        select(Notification).where(
            Notification.id == notification_id,
            Notification.user_id == current_account.id
        )
    )
    notif = result.scalar_one_or_none()
    if not notif:
        raise HTTPException(status_code=404, detail="Notification not found")
        
    notif.is_read = True
    await session.commit()
    return {"message": "Notification marked read"}


@app.websocket("/ws/{project_id}")
async def websocket_endpoint(
    websocket: WebSocket,
    project_id: int,
    token: str = Query(...),
    session: AsyncSession = Depends(get_session),
):
    """WebSocket endpoint for real-time chat in a channel.

    Auth: JWT passed as ?token=<jwt> query param (browser WebSocket API
    cannot set custom headers, so query-param auth is the standard pattern).

    Lifecycle:
      1. Verify token → load account → verify tenant membership
      2. If project is private (DM), verify explicit ProjectMember access
      3. Register in ConnectionManager room for this project_id
      4. On message receive → persist to DB → broadcast to all room members
      5. On disconnect → remove from room cleanly
    """
    # ── 1. Authenticate & authorise ───────────────────────────────────────────
    try:
        payload = decode_access_token(token)
        account_id = int(payload.get("sub"))
    except Exception:
        await websocket.close(code=4001)  # custom: Unauthorized
        return

    # Load account
    acc_result = await session.execute(select(Account).where(Account.id == account_id))
    account = acc_result.scalar_one_or_none()
    if account is None:
        await websocket.close(code=4001)
        return

    # Verify the project exists inside the account's active tenant
    if account.last_active_tenant_id is None:
        await websocket.close(code=4003)
        return

    # Special bypass for global connection (project_id=0) to receive personal events (e.g. invites)
    if project_id == 0:
        await ws_manager.connect(websocket, project_id, account_id)
        try:
            while True:
                await websocket.receive_text() # just keep-alive
        except WebSocketDisconnect:
            ws_manager.disconnect(websocket, project_id, account_id)
        return

    proj_result = await session.execute(
        select(Project).where(
            Project.id == project_id,
            Project.tenant_id == account.last_active_tenant_id,
        )
    )
    project = proj_result.scalar_one_or_none()
    if project is None:
        await websocket.close(code=4003)
        return

    # ── 2. Private DM access guard ────────────────────────────────────────────
    if project.is_private:
        pm_result = await session.execute(
            select(ProjectMember).where(
                ProjectMember.project_id == project_id,
                ProjectMember.account_id == account_id,
            )
        )
        if pm_result.scalar_one_or_none() is None:
            await websocket.close(code=4003)  # Forbidden
            return

    # ── 3. Accept & register ──────────────────────────────────────────────────
    await ws_manager.connect(websocket, project_id, account_id)

    try:
        while True:
            # ── 4. Receive, persist, broadcast ───────────────────────────────
            data = await websocket.receive_json()
            content = data.get("content", "").strip()
            file_url = data.get("file_url")
            file_type = data.get("file_type")
            parent_id = data.get("parent_id")
            if not content and not file_url:
                continue

            # Persist to database
            msg = Message(
                content=content,
                file_url=file_url,
                file_type=file_type,
                project_id=project_id,
                account_id=account.id,
                parent_id=parent_id,
            )
            session.add(msg)
            await session.commit()
            await session.refresh(msg)

            # Invalidate messages cache for this project
            redis_client = getattr(websocket.app.state, "arq_pool", None)
            await clear_message_cache(project_id, redis_client)

            # Build enriched broadcast payload
            broadcast_payload = {
                "id": msg.id,
                "content": msg.content,
                "file_url": msg.file_url,
                "file_type": msg.file_type,
                "created_at": msg.created_at.isoformat(),
                "project_id": msg.project_id,
                "account_id": msg.account_id,
                "sender_name": account.name,
                "parent_id": msg.parent_id,
            }

            # Check for mentions
            import re
            mentioned_names = re.findall(r"@([a-zA-Z0-9_]+)", content)
            if mentioned_names:
                # Find users by name in this tenant
                mentioned_accs_result = await session.execute(
                    select(Account)
                    .join(User, User.account_id == Account.id)
                    .where(
                        User.tenant_id == account.last_active_tenant_id,
                        Account.name.in_(mentioned_names)
                    )
                )
                mentioned_accs = mentioned_accs_result.scalars().all()
                for acc in mentioned_accs:
                    if acc.id != account.id:
                        notif = Notification(
                            user_id=acc.id,
                            actor_id=account.id,
                            type="mention",
                            project_id=project_id,
                            message_id=msg.id,
                            content_preview=f"{account.name} mentioned you: '{content[:50]}...'" if len(content) > 50 else f"{account.name} mentioned you: '{content}'"
                        )
                        session.add(notif)
                        await session.commit()
                        await session.refresh(notif)
                        
                        # Broadcast notification personally
                        await ws_manager.personal_broadcast({
                            "type": "NOTIFICATION",
                            "notification": {
                                "id": notif.id,
                                "type": notif.type,
                                "content_preview": notif.content_preview,
                                "project_id": notif.project_id
                            }
                        }, acc.id)

            # Fan-out to all viewers in this channel room (only ProjectMembers can connect,
            # so the broadcast is already scoped to authorised participants)
            await ws_manager.broadcast(broadcast_payload, project_id)

    except WebSocketDisconnect:
        # ── 5. Clean disconnect ───────────────────────────────────────────────
        ws_manager.disconnect(websocket, project_id, account_id)

