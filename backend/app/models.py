from typing import Optional
from sqlmodel import SQLModel, Field
from sqlalchemy import UniqueConstraint
from datetime import datetime
from enum import Enum

class UserRole(str, Enum):
    admin = "Admin"
    manager = "Manager"
    user = "User"

class AccountBase(SQLModel):
    name: str = Field(index=True)
    email: str = Field(unique=True, index=True)
    last_active_tenant_id: Optional[int] = Field(default=None, foreign_key="tenant.id")

class Account(AccountBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    hashed_password: str
    created_at: datetime = Field(default_factory=datetime.utcnow)

class AccountCreate(AccountBase):
    password: str

class TenantBase(SQLModel):
    name: str = Field(index=True)
    slug: str = Field(unique=True, index=True)

class Tenant(TenantBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    created_at: datetime = Field(default_factory=datetime.utcnow)

class TenantCreate(TenantBase):
    pass

class UserBase(SQLModel):
    account_id: int = Field(foreign_key="account.id", index=True)
    tenant_id: int = Field(foreign_key="tenant.id", index=True)
    role: UserRole = Field(default=UserRole.user)

class User(UserBase, table=True):
    __table_args__ = (UniqueConstraint("account_id", "tenant_id", name="uq_user_account_tenant"),)
    id: Optional[int] = Field(default=None, primary_key=True)
    created_at: datetime = Field(default_factory=datetime.utcnow)

class UserCreate(UserBase):
    pass


# ── Project ───────────────────────────────────────────────────────────────────

class ProjectBase(SQLModel):
    name: str = Field(index=True)
    description: Optional[str] = None

class Project(ProjectBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    created_at: datetime = Field(default_factory=datetime.utcnow)

    # THE SAFETY LOCK: every project belongs to exactly one tenant
    tenant_id: int = Field(foreign_key="tenant.id", index=True)

    # THE OWNER: which account created this project?
    created_by: int = Field(foreign_key="account.id")

    # Channel type: "channel" (public within tenant) or "dm" (private 1:1 / self)
    type: str = Field(default="channel", index=True)

    # Privacy flag — if True, only users in ProjectMember can access this project
    is_private: bool = Field(default=False)

class ProjectCreate(ProjectBase):
    pass   # tenant_id and created_by are injected by the route, not the caller

class ProjectRead(ProjectBase):
    id: int
    tenant_id: int
    created_by: int
    created_at: datetime
    type: str
    is_private: bool


# ── ProjectMember — Access Control List for private DM rooms ─────────────────

class ProjectMember(SQLModel, table=True):
    """Tracks which accounts are allowed into a private (DM) project room.

    For a self-DM: one row  (project_id, account_id).
    For a 1:1 DM: two rows (project_id, account_a_id) + (project_id, account_b_id).
    Public channels (is_private=False) do NOT use this table.
    """
    __table_args__ = (
        UniqueConstraint("project_id", "account_id", name="uq_projectmember_project_account"),
    )
    id: Optional[int] = Field(default=None, primary_key=True)
    project_id: int = Field(foreign_key="project.id", index=True)
    account_id: int = Field(foreign_key="account.id", index=True)


# ── Message ───────────────────────────────────────────────────────────────────

class Message(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    content: str
    created_at: datetime = Field(default_factory=datetime.utcnow)

    # Foreign keys — links each message to its channel and its author
    project_id: int = Field(foreign_key="project.id", index=True)
    account_id: int = Field(foreign_key="account.id", index=True)


class MessageRead(SQLModel):
    """Response schema — enriched with the sender's display name."""
    id: int
    content: str
    created_at: datetime
    project_id: int
    account_id: int
    sender_name: str
