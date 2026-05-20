from contextlib import asynccontextmanager
import os, re, urllib.request, urllib.parse, json
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
    ProjectMember, ChannelRole,
    Message, MessageRead,
    Invitation,
    UserProjectState, Notification,
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
# INVITES AND CONTACTS
# ─────────────────────────────────────────────────────────────────────────────

import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

class InviteRequest(BaseModel):
    emails: list[str]
    workspace_name: str
    base_url: str = "http://localhost:5174"

@app.post("/api/invite", tags=["Invites"])
async def send_invites(
    body: InviteRequest,
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

            # 3. Send Email
            msg = MIMEMultipart()
            msg['From'] = gmail_user
            msg['To'] = recipient
            msg['Subject'] = f"OmniBase: You've been invited to join the {body.workspace_name} workspace"

            safe_ws = urllib.parse.quote(body.workspace_name)
            safe_email = urllib.parse.quote(recipient)
            invite_url = f"{body.base_url}/signup?ws={safe_ws}&email={safe_email}"

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

    Privacy wall (layered):
      1. The project must belong to the caller's active tenant.
      2. If the project is private (DM), the caller must be a ProjectMember.
    """
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


@app.post("/projects/{project_id}/read", tags=["Messages"])
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


@app.get("/projects/unread-states", tags=["Projects"])
async def get_unread_states(
    session: AsyncSession = Depends(get_session),
    membership: User = Depends(get_verified_membership),
):
    """Returns a map of {project_id: unread_count} for the active tenant."""
    # Get all projects the user has access to in this tenant
    # (Simplified for now: we just count messages > last_read_message_id for all projects)
    # We will do this via a few queries
    
    # 1. Get user's read states
    states_result = await session.execute(
        select(UserProjectState).where(UserProjectState.account_id == membership.account_id)
    )
    states = {s.project_id: s.last_read_message_id for s in states_result.scalars().all()}
    
    # 2. Get the latest message ID for all projects in this tenant
    # To keep it simple, we iterate over projects the user can see (from list_projects logic)
    
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
        
    # Find latest message for each project, and total count for each project
    from sqlalchemy import func
    counts_result = await session.execute(
        select(Message.project_id, func.count(Message.id), func.max(Message.id))
        .where(Message.project_id.in_(all_pids))
        .group_by(Message.project_id)
    )
    
    unread_map = {}
    for pid, total_msgs, max_id in counts_result.all():
        last_read = states.get(pid, 0) or 0
        if last_read < max_id:
            # For exact count, we should count messages > last_read
            unread_msgs_result = await session.execute(
                select(func.count(Message.id))
                .where(Message.project_id == pid, Message.id > last_read)
            )
            unread_map[pid] = unread_msgs_result.scalar_one_or_none() or 0
        else:
            unread_map[pid] = 0
            
    return unread_map


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

