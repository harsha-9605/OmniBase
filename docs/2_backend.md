# OmniBase — Backend Documentation

> **Stack**: Python + FastAPI + SQLModel + SQLAlchemy (async) + Alembic + python-jose + bcrypt  
> **Location**: `c:\projects\OmniBase\backend\`  
> **Dev Command**: `uvicorn main:app --reload` (runs on `http://localhost:8000`)  
> **API Docs**: `http://localhost:8000/docs` (auto-generated Swagger UI by FastAPI)

---

## 1. Project Structure

```
backend/
├── main.py                   ← All API routes (entry point)
├── .env                      ← Secrets (DATABASE_URL, SECRET_KEY)
├── requirements.txt          ← Python dependencies
├── alembic.ini               ← Alembic migration config
├── migrations/
│   └── versions/             ← Auto-generated migration files
└── app/
    ├── auth.py               ← Password hashing + JWT creation/decoding
    ├── database.py           ← Async database engine + session factory
    ├── dependencies.py       ← FastAPI dependency functions (auth guards)
    ├── models.py             ← All SQLModel table definitions
    └── connection_manager.py ← WebSocket room management (in-memory)
```

---

## 2. Framework: FastAPI

FastAPI is a modern Python web framework for building APIs. Key reasons it was chosen:

- **Async-first**: All route handlers use `async def`, which means the server can handle thousands of requests without blocking.
- **Automatic Swagger docs**: Just by defining routes and Pydantic schemas, FastAPI generates a live interactive `/docs` page.
- **Dependency Injection**: Built-in system to inject shared resources (database session, current user) into any route.
- **WebSocket support**: Native WebSocket handling without extra libraries.

### App Initialization

```python
app = FastAPI(
    title="OmniBase API",
    description="B2B SaaS backend — Account / Tenant / User architecture",
    version="1.0.0",
    lifespan=lifespan,
)
```

### CORS Middleware

```python
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```
- CORS (Cross-Origin Resource Sharing) allows the React frontend (running on port 5173) to call the API (running on port 8000).
- `allow_origins=["*"]` means any origin is allowed (for development). In production this should be set to your specific domain.

---

## 3. `app/auth.py` — Password Hashing + JWT

### Password Hashing (bcrypt)

```python
import bcrypt

def hash_password(plain_password: str) -> str:
    return bcrypt.hashpw(plain_password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")

def verify_password(plain_password: str, hashed_password: str) -> bool:
    return bcrypt.checkpw(plain_password.encode("utf-8"), hashed_password.encode("utf-8"))
```

- **bcrypt** is a one-way hashing algorithm. You cannot reverse a bcrypt hash back to the plain password.
- `bcrypt.gensalt()` generates a random salt — two users with the same password will have different hashes.
- `verify_password` hashes the input and compares — it never decrypts.
- The hash is stored in the `account.hashed_password` column. The plain password is **never stored**.

### JWT (JSON Web Tokens)

```python
from jose import jwt

SECRET_KEY = os.getenv("SECRET_KEY", "change-me-before-going-to-production-please")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24  # 24 hours
```

**Creating a token:**
```python
def create_access_token(account_id: int) -> str:
    payload = {
        "sub": str(account_id),  # "sub" is JWT standard for "subject" (who this token is for)
        "exp": datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES),
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)
```

**Why `account_id` only (no `tenant_id` in the token)?**  
This is a critical design decision. If `tenant_id` was in the token, switching workspaces would require re-login because the old token would have the wrong workspace ID encoded in it. By only storing `account_id`, the token is valid for all workspaces — the active workspace is looked up dynamically from the `account.last_active_tenant_id` database column.

**Decoding a token:**
```python
def decode_access_token(token: str) -> dict:
    return jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
```
- Raises `JWTError` if the token is invalid or expired.
- Used in `dependencies.py` for HTTP routes and directly in the WebSocket route.

---

## 4. `app/database.py` — Async Database Connection

```python
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from dotenv import load_dotenv

load_dotenv()
DATABASE_URL = os.getenv("DATABASE_URL")

# Converts the URL scheme for asyncpg compatibility
if DATABASE_URL.startswith("postgresql://"):
    DATABASE_URL = DATABASE_URL.replace("postgresql://", "postgresql+asyncpg://", 1)

engine = create_async_engine(DATABASE_URL, echo=True)
async_session_maker = async_sessionmaker(engine, expire_on_commit=False)
```

**Key points:**
- **asyncpg** is the async PostgreSQL driver. SQLAlchemy needs the `postgresql+asyncpg://` scheme to use it.
- `echo=True` prints every SQL query to the console (useful for debugging).
- `expire_on_commit=False` — after a commit, SQLAlchemy by default expires all loaded objects. This flag prevents that, which is needed with async sessions.

**Session dependency (injected into routes):**
```python
async def get_session() -> AsyncSession:
    async with async_session_maker() as session:
        yield session
```
- Each request gets its own database session.
- `yield` makes it a FastAPI dependency — the session is opened before the route handler runs and closed automatically after.

---

## 5. `app/models.py` — Database Table Definitions

All tables are defined using **SQLModel** — a library that combines SQLAlchemy (database ORM) and Pydantic (data validation) in one class.

### Pattern: Base → Table Model → Create/Read Schemas

Every entity has up to 4 classes:
```
XxxBase      → Shared fields (used by all other classes)
Xxx          → The actual database table (table=True)
XxxCreate    → What the API accepts when creating (no id, no timestamps)
XxxRead      → What the API returns (computed/joined fields)
```

### Account Table

```python
class AccountBase(SQLModel):
    name: str = Field(index=True)
    email: str = Field(unique=True, index=True)
    last_active_tenant_id: Optional[int] = Field(default=None, foreign_key="tenant.id")

class Account(AccountBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    hashed_password: str
    created_at: datetime = Field(default_factory=datetime.utcnow)
```

| Column | Type | Notes |
|--------|------|-------|
| `id` | Integer PK | Auto-incremented |
| `name` | String | Indexed for fast lookup |
| `email` | String | Unique + indexed |
| `hashed_password` | String | bcrypt hash, never plain text |
| `last_active_tenant_id` | Integer FK → tenant.id | Which workspace is active |
| `created_at` | DateTime | Set automatically on insert |

### Tenant Table (Workspace)

```python
class Tenant(TenantBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    created_at: datetime = Field(default_factory=datetime.utcnow)
```

| Column | Type | Notes |
|--------|------|-------|
| `id` | Integer PK | Auto-incremented |
| `name` | String | Display name (e.g. "Harsha's Workspace") |
| `slug` | String | Unique URL-safe identifier (e.g. "harsha-s-workspace-5") |
| `created_at` | DateTime | Auto-set |

### User Table (Membership / Junction Table)

```python
class User(UserBase, table=True):
    __table_args__ = (UniqueConstraint("account_id", "tenant_id", name="uq_user_account_tenant"),)
    id: Optional[int] = Field(default=None, primary_key=True)
    created_at: datetime = Field(default_factory=datetime.utcnow)
```

| Column | Type | Notes |
|--------|------|-------|
| `id` | Integer PK | |
| `account_id` | Integer FK → account.id | |
| `tenant_id` | Integer FK → tenant.id | |
| `role` | Enum | `Admin` / `Manager` / `User` |
| `created_at` | DateTime | |

**Important**: The `UniqueConstraint` on `(account_id, tenant_id)` ensures one account cannot be added to the same workspace twice.

This table is a classic **many-to-many junction table** — one account can belong to many tenants, and one tenant can have many accounts.

### Project Table (Channel)

```python
class Project(ProjectBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    tenant_id: int = Field(foreign_key="tenant.id", index=True)  # SAFETY LOCK
    created_by: int = Field(foreign_key="account.id")
```

| Column | Type | Notes |
|--------|------|-------|
| `id` | Integer PK | |
| `name` | String | Channel name (e.g. "general") |
| `description` | String | Optional |
| `tenant_id` | Integer FK → tenant.id | Scopes the project to one workspace |
| `created_by` | Integer FK → account.id | Who created it |
| `created_at` | DateTime | |

### Message Table (Chat Messages)

```python
class Message(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    content: str
    created_at: datetime = Field(default_factory=datetime.utcnow)
    project_id: int = Field(foreign_key="project.id", index=True)
    account_id: int = Field(foreign_key="account.id", index=True)
```

| Column | Type | Notes |
|--------|------|-------|
| `id` | Integer PK | |
| `content` | String | The actual message text |
| `project_id` | Integer FK → project.id | Which channel this belongs to |
| `account_id` | Integer FK → account.id | Who sent it |
| `created_at` | DateTime | Indexed for chronological ordering |

---

## 6. `app/dependencies.py` — FastAPI Dependency Injection

These functions are injected into route handlers using `Depends()`. They run before the route logic and raise exceptions if checks fail.

### Step 1: `get_current_account`

```python
async def get_current_account(
    token: str = Depends(oauth2_scheme),
    session: AsyncSession = Depends(get_session),
) -> Account:
    payload = decode_access_token(token)
    account_id = int(payload.get("sub"))
    account = await session.execute(select(Account).where(Account.id == account_id))
    return account
```

- Reads the `Authorization: Bearer <token>` header automatically (via `OAuth2PasswordBearer`).
- Decodes the JWT → gets `account_id` from `"sub"` claim.
- Loads the full `Account` row from the database.
- Returns the account object OR raises `HTTP 401 Unauthorized`.

### Step 2: `get_tenant_context`

```python
async def get_tenant_context(current_account: Account = Depends(get_current_account)) -> int:
    if current_account.last_active_tenant_id is None:
        raise HTTPException(status_code=400, detail="No active tenant.")
    return current_account.last_active_tenant_id
```

### Step 3: `get_verified_membership` — THE PRIVACY WALL

```python
async def get_verified_membership(
    current_account: Account = Depends(get_current_account),
    session: AsyncSession = Depends(get_session),
) -> User:
    tenant_id = current_account.last_active_tenant_id
    membership = await session.execute(
        select(User).where(
            User.account_id == current_account.id,
            User.tenant_id == tenant_id,
        )
    )
    if membership is None:
        raise HTTPException(status_code=403, detail="You are not a member of this tenant.")
    return membership
```

This is the **most important security function** in the entire backend. It runs before any route that touches tenant-specific data (projects, messages, users).

- Checks the JWT is valid (via `get_current_account`).
- Checks the account has an active tenant set.
- Checks there is an actual `User` row in the database linking this account to that tenant.
- Returns the `User` object (which carries the `role` — Admin/Manager/User — for role-based access control).

**Why this matters:** Without this check, a logged-in user could forge a request to read another company's projects just by changing the `tenant_id` in their API call.

---

## 7. `main.py` — All API Routes

### Health Routes

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/` | None | Returns `{"message": "OmniBase API is running"}` |
| `GET` | `/api/health` | None | Returns `{"status": "ok"}` |

---

### Auth Routes

#### `POST /auth/signup` ← **Main signup route (Composite)**

This is the most complex route. Does 6 things in one atomic database transaction:

```python
# 1. Check for duplicate email
# 2. Create Account (with hashed password)
await session.flush()  # gets account.id without committing

# 3. Create Tenant (workspace) named "{name}'s Workspace"
# 4. Create User row (membership) with role=Admin
# 5. Create Project named "general" inside that tenant
# 6. Update account.last_active_tenant_id = tenant.id

await session.commit()  # all or nothing — if any step fails, nothing is saved

# 7. Generate and return JWT
token = create_access_token(account_id=account.id)
```

**Why `session.flush()` before `session.commit()`?**  
`flush()` sends the SQL to the database within the current transaction (gets the auto-generated ID) but doesn't finalize it. This lets you use `account.id` to build the tenant slug and membership row before the final commit.

**Response:**
```json
{
  "access_token": "eyJ...",
  "token_type": "bearer",
  "account_id": 5,
  "name": "Harsha",
  "email": "harsha@example.com",
  "tenant_id": 3,
  "tenant_name": "Harsha's Workspace"
}
```

#### `POST /accounts/login` ← **JSON login (preferred)**

```python
body: LoginRequest  # { email, password }
→ verify password with bcrypt
→ create_access_token(account_id)
→ return { access_token, token_type, account_id, name, email }
```

#### `POST /token` ← **OAuth2 form login (Swagger UI compatible)**

Same as `/accounts/login` but accepts `application/x-www-form-urlencoded` (standard OAuth2 format). Used by the Swagger `/docs` "Authorize" button.

#### `POST /accounts/register` ← **Simple register (no tenant provisioning)**

Creates only the `Account` row. No tenant, no project. Kept for testing purposes.

#### `GET /accounts/me` ← **Profile fetch**

```python
→ Depends(get_current_account)  # validates JWT automatically
→ returns { id, name, email, last_active_tenant_id }
```
Used by `App.jsx` on startup to fetch the logged-in user's details.

#### `POST /auth/google-token` ← **Google Sign-In/Up (Composite & Secure)**

This endpoint securely receives a Google Client-side OAuth 2.0 `access_token` and exchanges it for a local OmniBase JWT session, auto-provisioning the database schema for new users in a single atomic transaction.

```python
# 1. Contact Google's Userinfo API securely using standard library urllib
req = urllib.request.Request(
    "https://www.googleapis.com/oauth2/v3/userinfo",
    headers={"Authorization": f"Bearer {body.access_token}"}
)
with urllib.request.urlopen(req) as response:
    user_info = json.loads(response.read().decode())

# 2. Extract verified email and default name
google_email = user_info.get("email").lower().strip()
google_name = user_info.get("name") or google_email.split("@")[0]

# 3. Check for matching account in DB
# 4. If account exists:
#    - Generate and return OmniBase JWT token
# 5. If new account:
#    - Create Account (with empty hashed_password to pass constraints)
#    - Flush transaction to get account.id
#    - Create Tenant (Workspace) named "{Name}'s Workspace"
#    - Create User membership row as role=Admin
#    - Create default general Project (Channel)
#    - Set account.last_active_tenant_id to new tenant
#    - Commit atomic transaction
#    - Generate and return OmniBase JWT token
```

**Payload Schemas:**
*   **Request (`GoogleAuthRequest`)**:
    ```json
    {
      "access_token": "ya29.a0AR...",
      "name": "Harsha",
      "email": "harsha@example.com"
    }
    ```
*   **Response (Enriched local JWT payload)**:
    ```json
    {
      "access_token": "eyJ...",
      "token_type": "bearer",
      "account_id": 5,
      "name": "Harsha",
      "email": "harsha@example.com",
      "tenant_id": 3,
      "tenant_name": "Harsha's Workspace",
      "is_new_user": true
    }
    ```

---


### Tenant Routes

#### `POST /tenants/` — Create workspace

```python
→ Depends(get_current_account)
→ Creates Tenant row
→ Creates User row (Admin membership) for the caller
→ Updates account.last_active_tenant_id
→ Returns Tenant object
```

#### `GET /tenants/` — List my workspaces

```python
→ Depends(get_current_account)
→ SELECT tenants JOIN users WHERE users.account_id = current_account.id
→ Returns only tenants this account is a member of (not all tenants)
```

---

### User (Membership) Routes

#### `POST /users/` — Add member to workspace

```python
→ Depends(get_verified_membership)  # caller must be a member
→ Creates User row (adds account to tenant)
```

#### `GET /users/` — List all members

```python
→ Depends(get_verified_membership)  # privacy wall
→ SELECT user JOIN account WHERE user.tenant_id = membership.tenant_id
→ Returns enriched list: { id, account_id, tenant_id, role, name, email }
```

Note: The JOIN with `Account` is what allows us to return `name` and `email` alongside the membership data. This is used in the Home.jsx sidebar to show teammate names in the DMs section.

---

### Project (Channel) Routes

#### `POST /projects/` — Create channel

```python
→ Depends(get_verified_membership)
→ Project(
    name=project_in.name,
    tenant_id=membership.tenant_id,  # INJECTED — cannot be forged by caller
    created_by=membership.account_id  # INJECTED — cannot be forged by caller
)
```

**Security note:** The `tenant_id` and `created_by` are NOT accepted from the request body. They are pulled from the verified membership object, which came from the database. This prevents a user from creating a channel in a workspace they don't belong to.

#### `GET /projects/` — List channels

```python
→ Depends(get_verified_membership)
→ SELECT * FROM project WHERE tenant_id = membership.tenant_id
```

#### `DELETE /projects/{project_id}` — Delete channel

```python
→ Depends(get_verified_membership)
→ Role check: only Admin or Manager can delete
→ Also verifies project.tenant_id == membership.tenant_id (cross-tenant guard)
```

---

### Message Routes

#### `GET /projects/{project_id}/messages` — Load chat history

```python
→ Depends(get_verified_membership)
→ First verifies project belongs to caller's tenant
→ SELECT message JOIN account
   WHERE message.project_id = project_id
   ORDER BY created_at ASC
   LIMIT 50
→ Returns list of MessageRead objects (with sender_name included)
```

**Why the JOIN?** The `message` table only stores `account_id`. To show the sender's name in the chat UI, you need to join with the `account` table. This is done inline in the route query rather than adding SQLModel relationships.

#### `WS /ws/{project_id}?token=<jwt>` — Real-time chat WebSocket

Full lifecycle:
```python
# 1. Auth (token from query param, not header — browser WS can't set headers)
payload = decode_access_token(token)
account_id = int(payload.get("sub"))

# 2. Load account, verify tenant membership
account = await session.execute(select(Account)...)
proj = await session.execute(select(Project)...)

# 3. Accept connection and register in the room
await ws_manager.connect(websocket, project_id)

# 4. Message loop
while True:
    data = await websocket.receive_json()   # blocks until client sends something
    content = data.get("content", "").strip()

    # Persist to database
    msg = Message(content=content, project_id=project_id, account_id=account.id)
    session.add(msg)
    await session.commit()

    # Broadcast to all viewers
    await ws_manager.broadcast({
        "id": msg.id,
        "content": msg.content,
        "created_at": msg.created_at.isoformat(),
        "sender_name": account.name,
        ...
    }, project_id)

# 5. Clean disconnect
except WebSocketDisconnect:
    ws_manager.disconnect(websocket, project_id)
```

---

## 8. `app/connection_manager.py` — WebSocket Switchboard

```python
class ConnectionManager:
    def __init__(self):
        self.rooms: dict[int, list[WebSocket]] = {}
        # e.g. { 1: [ws_harsha, ws_rahul], 2: [ws_priya] }
```

**`connect(websocket, project_id)`:**
- Accepts the WebSocket handshake (`await websocket.accept()`).
- Creates the room list if it doesn't exist.
- Appends the new socket.

**`disconnect(websocket, project_id)`:**
- Removes the socket from the room list.
- Deletes the room entry entirely if it becomes empty (memory cleanup).

**`broadcast(message, project_id)`:**
- Iterates through all sockets in the room.
- Sends the JSON payload to each one.
- If a send fails (dead connection), adds it to a `dead_sockets` list.
- After iteration, removes all dead sockets.

**Singleton pattern:**
```python
manager = ConnectionManager()  # created once at module level
```
This single instance is shared across all incoming WebSocket connections. When Harsha sends a message, the same `manager` object that registered Rahul's connection is used to broadcast to him.

---

## 9. Dependencies (`requirements.txt`)

```
fastapi[standard]       ← FastAPI + Uvicorn (ASGI server) bundled together
sqlmodel                ← SQLAlchemy + Pydantic combined ORM
asyncpg                 ← Async PostgreSQL driver
python-dotenv           ← Reads .env file into os.environ
alembic                 ← Database migration tool
passlib[bcrypt]         ← bcrypt password hashing
python-jose[cryptography] ← JWT encoding/decoding
python-multipart        ← Required for OAuth2 form data parsing
```

---

## 10. Environment Variables (`.env`)

```env
DATABASE_URL="postgresql://user:password@host/dbname?sslmode=require"
SECRET_KEY="your-secret-key"
```

- `DATABASE_URL` is automatically transformed from `postgresql://` to `postgresql+asyncpg://` in `database.py`.
- `SECRET_KEY` is used to sign and verify JWT tokens. If someone knows this key, they can forge tokens.

---

## 11. Complete Route Summary Table

| Method | Path | Auth Required | Description |
|--------|------|---------------|-------------|
| GET | `/` | No | Health check |
| GET | `/api/health` | No | Health check |
| POST | `/auth/signup` | No | Create account + workspace + channel atomically |
| POST | `/auth/google-token` | No | Securely sign in/up via Google access token verification |
| POST | `/accounts/register` | No | Create account only |
| POST | `/accounts/login` | No | Login, get JWT |
| POST | `/token` | No | OAuth2 form login |
| GET | `/accounts/me` | JWT | Get logged-in user's profile |

| POST | `/tenants/` | JWT | Create new workspace |
| GET | `/tenants/` | JWT | List my workspaces |
| POST | `/users/` | JWT + Membership | Add member to workspace |
| GET | `/users/` | JWT + Membership | List workspace members (with name+email) |
| POST | `/projects/` | JWT + Membership | Create channel |
| GET | `/projects/` | JWT + Membership | List channels in active workspace |
| DELETE | `/projects/{id}` | JWT + Membership (Admin/Manager) | Delete channel |
| GET | `/projects/{id}/messages` | JWT + Membership | Load message history |
| WS | `/ws/{project_id}?token=` | JWT in query param | Real-time chat WebSocket |
