# OmniBase — Database Documentation

> **Database**: Neon PostgreSQL (serverless, cloud-hosted)  
> **ORM**: SQLModel (built on top of SQLAlchemy + Pydantic)  
> **Async Driver**: asyncpg  
> **Migrations**: Alembic  
> **Location of config**: `c:\projects\OmniBase\backend\`

---

## 1. What is Neon?

Neon is a **serverless PostgreSQL** database provider. Instead of running your own PostgreSQL server, Neon hosts it in the cloud. Key properties:

- **PostgreSQL-compatible** — standard SQL, standard foreign keys, standard indexes.
- **Serverless** — the database spins down when not in use and scales up automatically.
- **Connection**: Standard `postgresql://` connection string with SSL enforced.

The connection string is stored in `backend/.env`:
```
DATABASE_URL="postgresql://neondb_owner:...@ep-crimson-river-...neon.tech/neondb?sslmode=require"
```

In `database.py`, this is automatically converted to:
```
postgresql+asyncpg://...?ssl=require
```
Because the async driver `asyncpg` uses `ssl=` instead of `sslmode=`.

---

## 2. Architecture: B2B Multi-Tenant Design

OmniBase uses a **B2B multi-tenant architecture** — a single database serves multiple companies/organizations, each with complete data isolation.

### The Core Concept

```
Account (person)
    ↕ User (membership row — the bridge)
Tenant (organization/workspace)
    ↓
Project (channel inside that workspace)
    ↓
Message (chat message inside that channel)
```

### Why This Architecture?

**One Account, Multiple Workspaces:**  
A single person (Account) can be a member of multiple Tenants (workspaces). Instead of storing the workspace inside the account, there's a separate `User` table that creates the relationship.

**Workspace Isolation (Privacy Wall):**  
Every query for tenant-scoped data (projects, messages, members) includes a `WHERE tenant_id = X` clause. This ensures Workspace A can never accidentally see Workspace B's data, even if they're in the same database.

---

## 3. Entity Relationship Diagram

```
┌─────────────────┐       ┌──────────────────────────┐       ┌──────────────┐
│     account     │       │          user             │       │    tenant    │
│─────────────────│       │──────────────────────────│       │──────────────│
│ id (PK)         │◄──────│ account_id (FK)          │──────►│ id (PK)      │
│ name            │       │ tenant_id  (FK)           │       │ name         │
│ email (UNIQUE)  │       │ role (Admin/Manager/User) │       │ slug (UNIQUE)│
│ hashed_password │       │ id (PK)                  │       │ created_at   │
│ last_active_    │       │ created_at               │       └──────┬───────┘
│   tenant_id(FK)─┼──┐    └──────────────────────────┘              │
│ created_at      │  │                                               │
└────────┬────────┘  └───────────────────────────────────────────── ┘
         │                                                           │
         │                    ┌─────────────────────┐               │
         │                    │       project        │               │
         │                    │─────────────────────│               │
         └───────────────────►│ created_by (FK)     │◄──────────────┘
                              │ tenant_id (FK)       │
                              │ id (PK)              │
                              │ name                 │
                              │ description          │
                              │ created_at           │
                              └──────────┬───────────┘
                                         │
                              ┌──────────┴───────────┐
                              │       message         │
                              │──────────────────────│
                              │ id (PK)              │
                              │ content              │
                  ┌───────────│ account_id (FK)      │
                  │           │ project_id (FK)      │◄── (from project above)
                  │           │ created_at           │
                  │           └──────────────────────┘
                  │
                  └──────────► account.id
```

---

## 4. Table Details

### Table: `account`

The core identity table. One row = one registered user.

| Column | PostgreSQL Type | Constraints | Notes |
|--------|----------------|-------------|-------|
| `id` | `INTEGER` | PRIMARY KEY, AUTO-INCREMENT | System-generated |
| `name` | `VARCHAR` | NOT NULL, INDEX | User's display name |
| `email` | `VARCHAR` | NOT NULL, UNIQUE, INDEX | Used for login |
| `hashed_password` | `VARCHAR` | NOT NULL | bcrypt hash — never plaintext. For Google OAuth users, this field is set to an empty string `""` to satisfy the DB constraint without requiring schema modifications. |
| `last_active_tenant_id` | `INTEGER` | NULLABLE, FK → `tenant.id` | Tracks which workspace is active |
| `created_at` | `TIMESTAMP` | NOT NULL | Set to current UTC time on insert |


**Key Index:**
- `ix_account_email` (UNIQUE) — enables fast `WHERE email = ?` lookups during login.

**Important Design Note — `last_active_tenant_id`:**  
This column acts as a "currently selected workspace" pointer. When a user signs up, it gets set to their first tenant. When they create or switch workspaces, it updates. The JWT token does NOT store the tenant — instead, every authenticated request reads this column from the database. This allows workspace switching without re-authentication.

---

### Table: `tenant`

One row = one workspace/organization.

| Column | PostgreSQL Type | Constraints | Notes |
|--------|----------------|-------------|-------|
| `id` | `INTEGER` | PRIMARY KEY, AUTO-INCREMENT | |
| `name` | `VARCHAR` | NOT NULL, INDEX | Display name (e.g. "Harsha's Workspace") |
| `slug` | `VARCHAR` | NOT NULL, UNIQUE, INDEX | URL-safe name (e.g. "harsha-s-workspace-5") |
| `created_at` | `TIMESTAMP` | NOT NULL | |

**Key Index:**
- `ix_tenant_slug` (UNIQUE) — slug must be globally unique across all workspaces.

**How slug is generated:**
```python
base_slug = re.sub(r'[^a-z0-9]+', '-', tenant_name.lower()).strip('-')
slug = f"{base_slug}-{account.id}"
# e.g. "harsha-s-workspace-5"
```
The account ID at the end guarantees uniqueness even if two people use the same name.

---

### Table: `user` (Membership / Junction Table)

One row = one account's membership in one tenant.

| Column | PostgreSQL Type | Constraints | Notes |
|--------|----------------|-------------|-------|
| `id` | `INTEGER` | PRIMARY KEY | |
| `account_id` | `INTEGER` | NOT NULL, FK → `account.id`, INDEX | Who |
| `tenant_id` | `INTEGER` | NOT NULL, FK → `tenant.id`, INDEX | Where |
| `role` | `ENUM('Admin','Manager','User')` | NOT NULL, DEFAULT 'User' | Permission level |
| `created_at` | `TIMESTAMP` | NOT NULL | |

**Unique Constraint:**
```sql
UNIQUE(account_id, tenant_id)  -- named: uq_user_account_tenant
```
An account can only have ONE membership record per tenant. You cannot be added to the same workspace twice.

**Roles:**
- `Admin` — Full control (create/delete anything, manage members). Automatically assigned to the workspace creator.
- `Manager` — Can create/delete channels.
- `User` — Can read and write messages only.

**Why is this called `user` and not `membership`?**  
In a B2B SaaS context, the "user" is the representation of an "account" acting within a specific "tenant". The `Account` is the global identity; the `User` is the tenant-scoped identity. This follows the standard terminology from systems like Slack (where your "workspace profile" is separate from your global Slack account).

---

### Table: `project` (Channel)

One row = one channel inside a workspace.

| Column | PostgreSQL Type | Constraints | Notes |
|--------|----------------|-------------|-------|
| `id` | `INTEGER` | PRIMARY KEY | |
| `name` | `VARCHAR` | NOT NULL, INDEX | Channel name (e.g. "general") |
| `description` | `VARCHAR` | NULLABLE | Channel description |
| `tenant_id` | `INTEGER` | NOT NULL, FK → `tenant.id`, INDEX | Which workspace owns this |
| `created_by` | `INTEGER` | NOT NULL, FK → `account.id` | Who created it |
| `created_at` | `TIMESTAMP` | NOT NULL | |

**Key Index:**
- `ix_project_tenant_id` — enables fast `WHERE tenant_id = ?` (used in every channel listing query).

**Why is it called `project` and not `channel`?**  
The original design vision was that each "channel" represents a project space (like Slack channels named after projects). The concept maps: Project in the database = Channel in the UI.

**Automatic creation on signup:**  
When a new user signs up via `/auth/signup`, a default project named `"general"` is created in their new tenant automatically. The user never has to manually create a first channel.

---

### Table: `message`

One row = one chat message.

| Column | PostgreSQL Type | Constraints | Notes |
|--------|----------------|-------------|-------|
| `id` | `INTEGER` | PRIMARY KEY | |
| `content` | `VARCHAR` | NOT NULL | The text of the message |
| `project_id` | `INTEGER` | NOT NULL, FK → `project.id`, INDEX | Which channel |
| `account_id` | `INTEGER` | NOT NULL, FK → `account.id`, INDEX | Who sent it |
| `created_at` | `TIMESTAMP` | NOT NULL | Used for chronological ordering |

**Key Indexes:**
- `ix_message_project_id` — enables fast `WHERE project_id = ?` (fetching all messages in a channel).
- `ix_message_account_id` — enables fast `WHERE account_id = ?` (fetching a user's messages).

**Why `account_id` and not `user_id`?**  
`account_id` is more stable. Even if a user's membership (their `User` row) is removed from a workspace, the `account.id` still exists and the message history is preserved.

**The JOIN pattern:**  
The `message` table stores `account_id` (a number). To display the sender's name in the UI, the API joins with the `account` table:
```sql
SELECT message.*, account.name AS sender_name
FROM message
JOIN account ON message.account_id = account.id
WHERE message.project_id = ?
ORDER BY message.created_at ASC
LIMIT 50
```

---

## 5. Alembic Migrations

Alembic is a database migration tool — it tracks changes to your schema and applies them to the live database in order, without data loss.

### How it works

1. You change `models.py` (add a table, add a column).
2. Run `alembic revision --autogenerate -m "description"` — Alembic compares your models to the live database and generates a migration file.
3. Run `alembic upgrade head` — applies all pending migrations to the live Neon database.

### Migration History

All migration files are in `backend/migrations/versions/`.

#### Migration 1: `7f51cf5d44e0_initial_b2b_saas_schema.py`

**Date:** 2026-05-11  
**What it did:**
- Created `tenant` table with `name`, `slug`, `created_at`, indexes.
- Created `account` table with `email`, `hashed_password`, `last_active_tenant_id`, FK to `tenant`.
- Created `user` table with `account_id`, `tenant_id`, `role` enum, unique constraint on `(account_id, tenant_id)`.
- Dropped a test table called `skeletontest` (leftover from initial setup).

#### Migration 2: `c42bcf29830b_add_name_to_account.py`

**What it did:**
- Added the `name` column to the `account` table.
- This was added later when the requirement came in to store the user's display name.

#### Migration 3: `2871d0b9d28f_add_project_table.py`

**Date:** 2026-05-12  
**What it did:**
- Created the `project` table.
- Added `tenant_id` (FK → `tenant.id`) and `created_by` (FK → `account.id`) with proper foreign key constraints.
- Created indexes: `ix_project_name` and `ix_project_tenant_id`.

#### Migration 4: `82a5d82a3e77_add_message_table.py`

**What it did:**
- Created the `message` table.
- Added foreign keys to both `project.id` and `account.id`.
- Created indexes: `ix_message_project_id` and `ix_message_account_id`.
- This was the migration that enabled permanent chat history storage.

### Running Migrations

```bash
# Check current database version
alembic current

# See what migrations are pending
alembic history

# Generate a new migration from model changes
alembic revision --autogenerate -m "describe_what_changed"

# Apply all pending migrations
alembic upgrade head

# Roll back one migration
alembic downgrade -1
```

---

## 6. Data Isolation: How Multi-Tenancy Works in Practice

### Scenario: Harsha and Rahul both use OmniBase

```
account table:
│ id │ name   │ email          │ last_active_tenant_id │
│ 5  │ Harsha │ h@example.com  │ 3                     │
│ 6  │ Rahul  │ r@example.com  │ 7                     │

tenant table:
│ id │ name                 │
│ 3  │ Harsha's Workspace   │
│ 7  │ Rahul's Company      │

user table:
│ id │ account_id │ tenant_id │ role  │
│ 1  │ 5          │ 3         │ Admin │  ← Harsha in his own workspace
│ 2  │ 6          │ 7         │ Admin │  ← Rahul in his own workspace
```

When Harsha makes a request to `GET /projects/`, the `get_verified_membership` dependency:
1. Reads Harsha's JWT → gets `account_id = 5`.
2. Reads `account.last_active_tenant_id = 3` from the database.
3. Queries `User WHERE account_id=5 AND tenant_id=3` → finds the row → confirmed member.
4. The route then queries `SELECT * FROM project WHERE tenant_id = 3`.

Rahul's projects (tenant_id=7) are **never fetched** — not filtered out, just never in the query.

---

## 7. Indexes: Why They Matter

| Table | Index | Columns | Type | Purpose |
|-------|-------|---------|------|---------|
| account | `ix_account_email` | `email` | UNIQUE | Fast login lookup |
| account | `ix_account_name` | `name` | Normal | Fast name search |
| tenant | `ix_tenant_slug` | `slug` | UNIQUE | Fast workspace lookup |
| tenant | `ix_tenant_name` | `name` | Normal | Fast name search |
| user | `ix_user_account_id` | `account_id` | Normal | Find all workspaces for a user |
| user | `ix_user_tenant_id` | `tenant_id` | Normal | Find all members of a workspace |
| project | `ix_project_tenant_id` | `tenant_id` | Normal | List channels in a workspace |
| project | `ix_project_name` | `name` | Normal | Channel name search |
| message | `ix_message_project_id` | `project_id` | Normal | Fetch messages by channel |
| message | `ix_message_account_id` | `account_id` | Normal | Fetch messages by user |

Without the `ix_message_project_id` index, fetching the 50 most recent messages in a channel would require scanning the entire `message` table. With the index, PostgreSQL jumps directly to the matching rows.
