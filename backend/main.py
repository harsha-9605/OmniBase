from contextlib import asynccontextmanager
from fastapi import FastAPI, Depends, HTTPException, status
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
)
from app.auth import hash_password, verify_password, create_access_token
from app.dependencies import get_current_account, get_tenant_context, get_verified_membership


# ── Pydantic schema for JSON-body login ───────────────────────────────────────
class LoginRequest(BaseModel):
    email: EmailStr
    password: str


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
        last_active_tenant_id=account.last_active_tenant_id,
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
        last_active_tenant_id=account.last_active_tenant_id,
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


@app.get("/users/", response_model=list[User], tags=["Users"])
async def get_members(
    session: AsyncSession = Depends(get_session),
    membership: User = Depends(get_verified_membership),
):
    """Returns all members of the current active tenant ONLY.
    Privacy Wall: only members of this tenant can see its member list."""
    result = await session.execute(
        select(User).where(User.tenant_id == membership.tenant_id)
    )
    return list(result.scalars().all())


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
