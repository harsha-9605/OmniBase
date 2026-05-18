from contextlib import asynccontextmanager
import os, re, urllib.request, json
from fastapi import FastAPI, Depends, HTTPException, status, WebSocket, WebSocketDisconnect, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import BaseModel, EmailStr
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.database import get_session
from app.models import (
    Tenant, TenantCreate,
    User, UserCreate,
    Account, AccountCreate,
    Project, ProjectCreate, ProjectRead,
    Message, MessageRead,
)
from app.auth import hash_password, verify_password, create_access_token, decode_access_token
from app.dependencies import get_current_account, get_tenant_context, get_verified_membership
from app.connection_manager import manager as ws_manager

GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "")


# ── Pydantic schema for JSON-body login ───────────────────────────────────────
class LoginRequest(BaseModel):
    email: EmailStr
    password: str

class SignupRequest(BaseModel):
    name: str
    email: EmailStr
    password: str

class GoogleAuthRequest(BaseModel):
    access_token: str
    name: str
    email: EmailStr


@asynccontextmanager
async def lifespan(app: FastAPI):
    print("OmniBase API starting up. Alembic handles migrations.")
    yield

app = FastAPI(
    title="OmniBase API",
    description="B2B SaaS backend — Account / Tenant / User architecture",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
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

@app.post("/accounts/register", response_model=dict, tags=["Auth"])
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


@app.post("/auth/signup", response_model=dict, tags=["Auth"])
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
    
    # 5. Create default Project
    project = Project(
        name="general",
        description="General discussions and updates",
        tenant_id=tenant.id,
        created_by=account.id,
    )
    session.add(project)
    
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


@app.post("/token", tags=["Auth"])
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


@app.post("/accounts/login", response_model=dict, tags=["Auth"])
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


@app.post("/auth/google-token", response_model=dict, tags=["Auth"])
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

    if google_email != body.email.lower().strip():
        raise HTTPException(status_code=400, detail="Email mismatch.")

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
# TENANTS — Protected by auth + tenant context
# ─────────────────────────────────────────────────────────────────────────────

@app.post("/tenants/", response_model=Tenant, tags=["Tenants"])
async def create_tenant(
    tenant_in: TenantCreate,
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
    )
    session.add(project)
    await session.commit()
    await session.refresh(project)
    return project


@app.get("/projects/", response_model=list[ProjectRead], tags=["Projects"])
async def list_projects(
    session: AsyncSession = Depends(get_session),
    membership: User = Depends(get_verified_membership),   # ← Privacy Wall
):
    """List ALL projects that belong to the caller's active tenant.

    Projects from other tenants are invisible — not filtered out, just
    never fetched. The WHERE clause is the data boundary."""
    result = await session.execute(
        select(Project).where(Project.tenant_id == membership.tenant_id)
    )
    return list(result.scalars().all())


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


# ─────────────────────────────────────────────────────────────────────────────
# MESSAGES — REST history + WebSocket real-time
# ─────────────────────────────────────────────────────────────────────────────

@app.get("/projects/{project_id}/messages", response_model=list[MessageRead], tags=["Messages"])
async def get_message_history(
    project_id: int,
    limit: int = 50,
    session: AsyncSession = Depends(get_session),
    membership: User = Depends(get_verified_membership),
):
    """Return the last `limit` messages for a channel, newest at the bottom.
    Privacy wall: the project must belong to the caller's active tenant."""
    # First verify the project belongs to the caller's tenant
    proj_result = await session.execute(
        select(Project).where(
            Project.id == project_id,
            Project.tenant_id == membership.tenant_id,
        )
    )
    if proj_result.scalar_one_or_none() is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Channel not found in your workspace.",
        )

    # Fetch last N messages joined with the account name
    result = await session.execute(
        select(Message, Account)
        .join(Account, Message.account_id == Account.id)
        .where(Message.project_id == project_id)
        .order_by(Message.created_at.asc())
        .limit(limit)
    )

    messages = []
    for msg, account in result.all():
        messages.append(MessageRead(
            id=msg.id,
            content=msg.content,
            created_at=msg.created_at,
            project_id=msg.project_id,
            account_id=msg.account_id,
            sender_name=account.name,
        ))
    return messages


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
      1. Verify token → load account → verify membership in target project's tenant
      2. Register in ConnectionManager room for this project_id
      3. On message receive → persist to DB → broadcast to all room members
      4. On disconnect → remove from room cleanly
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

    proj_result = await session.execute(
        select(Project).where(
            Project.id == project_id,
            Project.tenant_id == account.last_active_tenant_id,
        )
    )
    if proj_result.scalar_one_or_none() is None:
        await websocket.close(code=4003)
        return

    # ── 2. Accept & register ──────────────────────────────────────────────────
    await ws_manager.connect(websocket, project_id)

    try:
        while True:
            # ── 3. Receive, persist, broadcast ───────────────────────────────
            data = await websocket.receive_json()
            content = data.get("content", "").strip()
            if not content:
                continue

            # Persist to database
            msg = Message(
                content=content,
                project_id=project_id,
                account_id=account.id,
            )
            session.add(msg)
            await session.commit()
            await session.refresh(msg)

            # Build enriched broadcast payload
            broadcast_payload = {
                "id": msg.id,
                "content": msg.content,
                "created_at": msg.created_at.isoformat(),
                "project_id": msg.project_id,
                "account_id": msg.account_id,
                "sender_name": account.name,
            }

            # Fan-out to all viewers in this channel room
            await ws_manager.broadcast(broadcast_payload, project_id)

    except WebSocketDisconnect:
        # ── 4. Clean disconnect ───────────────────────────────────────────────
        ws_manager.disconnect(websocket, project_id)

