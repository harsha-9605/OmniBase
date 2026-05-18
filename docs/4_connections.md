# OmniBase — Connections & Integration Documentation

> This document explains **how the frontend and backend talk to each other** — every connection, every data flow, and every technology bridge from the user's browser to the Neon PostgreSQL database.

---

## 1. The Big Picture: System Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    USER'S BROWSER                        │
│                                                         │
│  React App (port 5173)                                  │
│  ┌──────────────────────────────────────────────────┐  │
│  │  App.jsx → Workspace.jsx → Home.jsx              │  │
│  │         └── SignUp.jsx                           │  │
│  │                                                  │  │
│  │  api.js (Axios)  ←── HTTP REST calls ──►        │  │
│  │  WebSocket API   ←── ws:// connection ──►        │  │
│  └──────────────────────────────────────────────────┘  │
└───────────────────┬────────────────────────────────────┘
                    │ HTTP (port 8000) + WebSocket
                    │
┌───────────────────▼────────────────────────────────────┐
│                  FastAPI BACKEND                         │
│                  (localhost:8000)                        │
│                                                         │
│  main.py — All routes                                   │
│  ├── Auth: /auth/signup, /accounts/login, /accounts/me │
│  ├── Tenants: /tenants/                                 │
│  ├── Projects: /projects/                               │
│  ├── Messages: /projects/{id}/messages                  │
│  └── WebSocket: /ws/{project_id}?token=                │
│                                                         │
│  app/auth.py         — bcrypt + JWT                     │
│  app/dependencies.py — auth guards (privacy wall)       │
│  app/connection_manager.py — WebSocket rooms            │
└───────────────────┬────────────────────────────────────┘
                    │ asyncpg (SSL encrypted)
                    │
┌───────────────────▼────────────────────────────────────┐
│              Neon PostgreSQL (Cloud)                     │
│                                                         │
│  Tables: account, tenant, user, project, message        │
└────────────────────────────────────────────────────────┘
```

---

## 2. Technology Bridge: How Frontend Talks to Backend

### HTTP (REST API) — via Axios

The frontend uses **Axios** (an HTTP client library) to make REST API calls.

**Configured in `frontend/src/api.js`:**
```js
const api = axios.create({ baseURL: 'http://localhost:8000' })
```

This means `api.get('/projects/')` becomes a real HTTP GET request to `http://localhost:8000/projects/`.

Every call flows through two interceptors:

**Before every request (Request Interceptor):**
```
[React component calls api.get('/projects/')]
    ↓
[Request Interceptor reads JWT from localStorage]
    ↓
[Attaches header: Authorization: Bearer eyJ...]
    ↓
[HTTP GET request sent to FastAPI]
```

**After every response (Response Interceptor):**
```
[FastAPI responds]
    ↓
[If 200 OK → pass response to the component]
[If 401 Unauthorized → clear token, reload page → back to login]
```

### WebSocket — via Browser Native API

The frontend uses the browser's built-in `WebSocket` class for real-time chat.

```
[User clicks a channel → switchChannel(projectId, name)]
    ↓
[New WebSocket('ws://localhost:8000/ws/3?token=eyJ...')]
    ↓
[Browser sends WebSocket upgrade handshake to FastAPI]
    ↓
[FastAPI accepts, validates token, registers connection in ConnectionManager]
    ↓
[Persistent bi-directional connection stays open]
    ↓
[User types message → ws.send(JSON.stringify({content: '...'})) ]
    ↓
[FastAPI receives → saves to DB → broadcasts to all viewers]
    ↓
[ws.onmessage fires → React updates state → UI re-renders]
```

### CORS: Why Both Ports Can Talk

The frontend runs on port `5173` and the backend on port `8000`. Normally browsers block requests between different ports (same-origin policy). CORS middleware on the backend lifts that restriction:

```python
app.add_middleware(CORSMiddleware, allow_origins=["*"], ...)
```
This tells the browser: "It's OK to send requests to this backend from any origin."

---

## 3. Complete Flow: User Signs Up

This is the most complex flow — it touches every layer.

```
BROWSER                      BACKEND                           DATABASE
  │                              │                                │
  │ User fills form:             │                                │
  │ Name: "Harsha"               │                                │
  │ Email: "h@x.com"             │                                │
  │ Password: "secret123"        │                                │
  │                              │                                │
  │──POST /auth/signup──────────►│                                │
  │ Body: {name, email, password}│                                │
  │                              │──SELECT account WHERE email──►│
  │                              │◄──(no result — email is new)──│
  │                              │                                │
  │                              │ hash("secret123") = "$2b$..."  │
  │                              │                                │
  │                              │──INSERT INTO account──────────►│
  │                              │ (name, email, hashed_password) │
  │                              │◄──(account.id = 5)────────────│
  │                              │                                │
  │                              │──INSERT INTO tenant───────────►│
  │                              │ ("Harsha's Workspace", slug)   │
  │                              │◄──(tenant.id = 3)─────────────│
  │                              │                                │
  │                              │──INSERT INTO user─────────────►│
  │                              │ (account_id=5, tenant_id=3,    │
  │                              │  role='Admin')                 │
  │                              │                                │
  │                              │──INSERT INTO project──────────►│
  │                              │ (name='general', tenant_id=3,  │
  │                              │  created_by=5)                 │
  │                              │                                │
  │                              │──UPDATE account───────────────►│
  │                              │  SET last_active_tenant_id=3   │
  │                              │  WHERE id=5                    │
  │                              │                                │
  │                              │──COMMIT (all or nothing)───────►│
  │                              │                                │
  │                              │ JWT = sign({sub:"5"}, secret)  │
  │                              │                                │
  │◄──200 OK────────────────────│                                │
  │ {access_token, name, email,  │                                │
  │  tenant_id, tenant_name}     │                                │
  │                              │                                │
  │ localStorage.setItem(        │                                │
  │  'omnibase_token', token)    │                                │
  │                              │                                │
  │ setView('workspace')         │                                │
  │ → renders Workspace.jsx      │                                │
```

---

## 3.5. Complete Flow: Google OAuth Sign-In / Sign-Up

This diagram tracks how the implicit Google OAuth access token flow registers or signs in a user and establishes their workspace environment.

```
BROWSER                      BACKEND                           DATABASE
  │                              │                                │
  │ User clicks "Google Login"   │                                │
  │ Opens Google popup           │                                │
  │ Grant permissions            │                                │
  │◄──Returns Access Token───────│                                │
  │                              │                                │
  │ Fetch profile details:       │                                │
  │ Name: "Harsha"               │                                │
  │ Email: "h@gmail.com"         │                                │
  │                              │                                │
  │──POST /auth/google-token────►│                                │
  │ Body: {access_token,         │                                │
  │        name, email}          │                                │
  │                              │                                │
  │                              │ Verify access token by         │
  │                              │ contacting Google userinfo API │
  │                              │──GET /v3/userinfo─────────────►│ (Google Auth Server)
  │                              │◄──Returns verified user profile│
  │                              │                                │
  │                              │──SELECT account WHERE email──►│
  │                              │◄──(no result — email is new)──│
  │                              │                                │
  │                              │──INSERT INTO account──────────►│
  │                              │ (name, email,                  │
  │                              │  hashed_password="")           │
  │                              │◄──(account.id = 5)────────────│
  │                              │                                │
  │                              │──INSERT INTO tenant───────────►│
  │                              │ ("Harsha's Workspace", slug)   │
  │                              │◄──(tenant.id = 3)─────────────│
  │                              │                                │
  │                              │──INSERT INTO user─────────────►│
  │                              │ (account_id=5, tenant_id=3,    │
  │                              │  role='Admin')                 │
  │                              │                                │
  │                              │──INSERT INTO project──────────►│
  │                              │ (name='general', tenant_id=3,  │
  │                              │  created_by=5)                 │
  │                              │                                │
  │                              │──UPDATE account───────────────►│
  │                              │  SET last_active_tenant_id=3   │
  │                              │  WHERE id=5                    │
  │                              │                                │
  │                              │──COMMIT (all or nothing)───────►│
  │                              │                                │
  │                              │ JWT = sign({sub:"5"}, secret)  │
  │                              │                                │
  │◄──200 OK (Enriched Response)─│                                │
  │ {access_token, name, email,  │                                │
  │  tenant_id, tenant_name,     │                                │
  │  is_new_user: true}          │                                │
  │                              │                                │
  │ localStorage.setItem(        │                                │
  │  'omnibase_token', JWT)      │                                │
  │                              │                                │
  │ setView('workspace')         │                                │
```

---


## 4. Complete Flow: App Loads (Returning User)

```
BROWSER                      BACKEND                           DATABASE
  │                              │                                │
  │ window.location loads        │                                │
  │ React app starts             │                                │
  │                              │                                │
  │ App.jsx useState():          │                                │
  │  token = localStorage        │                                │
  │  .getItem('omnibase_token')  │                                │
  │                              │                                │
  │  → token exists!             │                                │
  │  → setView('workspace')      │                                │
  │                              │                                │
  │ App.jsx useEffect():         │                                │
  │  (cleanup old mock keys)     │                                │
  │                              │                                │
  │──GET /accounts/me───────────►│                                │
  │ Header: Bearer eyJ...        │                                │
  │                              │ decode JWT → account_id=5     │
  │                              │──SELECT account WHERE id=5───►│
  │                              │◄──(Harsha's account row)──────│
  │◄──200 {id,name,email,...}───│                                │
  │                              │                                │
  │ setUserProfile({name,email}) │                                │
  │ passes profile to Workspace  │                                │
  │ → passes to Home.jsx         │                                │
```

---

## 5. Complete Flow: User Opens Dashboard (Home.jsx)

```
BROWSER                      BACKEND                           DATABASE
  │                              │                                │
  │ Home.jsx mounts              │                                │
  │                              │                                │
  │ useEffect([tenantId]):        │                                │
  │  Promise.all([               │                                │
  │──GET /projects/─────────────►│                                │
  │ Bearer token attached        │                                │
  │                              │ get_verified_membership:       │
  │                              │  decode JWT → account_id=5    │
  │                              │  account.last_active_          │
  │                              │    tenant_id = 3               │
  │                              │  SELECT user WHERE             │
  │                              │  account_id=5,tenant_id=3     │
  │                              │  → User row found (Admin)      │
  │                              │──SELECT project                │
  │                              │  WHERE tenant_id=3────────────►│
  │                              │◄──[{id:1,name:"general"}]──────│
  │◄──[{id:1,name:"general"}]───│                                │
  │                              │                                │
  │──GET /users/────────────────►│                                │
  │                              │ get_verified_membership (same) │
  │                              │──SELECT user JOIN account      │
  │                              │  WHERE tenant_id=3────────────►│
  │                              │◄──[{name:"Harsha",role:Admin}]─│
  │◄──[{name,email,role,...}]────│                                │
  │                              │                                │
  │ setChannels([...])           │                                │
  │ setInvitedList([...])        │                                │
  │                              │                                │
  │ switchChannel(1, "general")  │                                │
  │  (auto-connects to 1st ch)   │                                │
```

---

## 6. Complete Flow: User Clicks a Channel

```
BROWSER                      BACKEND                           DATABASE
  │                              │                                │
  │ switchChannel(projectId=1,   │                                │
  │               "general")     │                                │
  │                              │                                │
  │ 1. Close old WebSocket       │                                │
  │    wsRef.current.close()     │                                │
  │                              │                                │
  │ 2. Load history:             │                                │
  │──GET /projects/1/messages───►│                                │
  │ Bearer token                 │                                │
  │                              │ get_verified_membership (auth) │
  │                              │ Verify project 1 in tenant 3  │
  │                              │──SELECT message JOIN account   │
  │                              │  WHERE project_id=1            │
  │                              │  ORDER BY created_at ASC       │
  │                              │  LIMIT 50─────────────────────►│
  │                              │◄──[{id,content,sender_name,    │
  │                              │     created_at,...}]────────────│
  │◄──[messages array]──────────│                                │
  │                              │                                │
  │ setChannelMessages(          │                                │
  │  res.data.map(formatMsg))    │                                │
  │                              │                                │
  │ 3. Open WebSocket:           │                                │
  │──WS ws://localhost:8000/─────►│                                │
  │   ws/1?token=eyJ...          │                                │
  │                              │ Decode JWT → account_id=5     │
  │                              │ Load account from DB           │
  │                              │ Verify project 1 in tenant 3  │
  │                              │ ws_manager.connect(ws, 1)      │
  │                              │ rooms = { 1: [ws_harsha] }    │
  │◄──WebSocket OPEN────────────│                                │
  │                              │                                │
  │ wsRef.current = ws           │                                │
```

---

## 7. Complete Flow: User Sends a Message

```
BROWSER (Harsha)     BROWSER (Rahul)     BACKEND               DATABASE
  │                       │                  │                     │
  │ Harsha types:          │                  │                     │
  │ "Hey Rahul!"           │                  │                     │
  │                       │                  │                     │
  │ handleSendMessage():   │                  │                     │
  │  ws.send(JSON({        │                  │                     │
  │   content:"Hey Rahul!" │                  │                     │
  │  }))                   │                  │                     │
  │──WebSocket send───────────────────────────►│                     │
  │                       │                  │                     │
  │ (Harsha does NOT see  │                  │ receive_json()      │
  │  message yet locally) │                  │ content = "Hey Rahul!"
  │                       │                  │                     │
  │                       │                  │──INSERT INTO message►│
  │                       │                  │ (content, project_id,│
  │                       │                  │  account_id, created)│
  │                       │                  │◄──(msg.id = 42, ─────│
  │                       │                  │   created_at = ...)  │
  │                       │                  │                     │
  │                       │                  │ broadcast_payload = {│
  │                       │                  │  id: 42,            │
  │                       │                  │  content: "Hey..",  │
  │                       │                  │  sender_name:"Harsha"│
  │                       │                  │  created_at: "..."  │
  │                       │                  │ }                   │
  │                       │                  │                     │
  │                       │                  │ rooms[1] = [ws_harsha, ws_rahul]
  │                       │                  │                     │
  │◄──WebSocket broadcast─────────────────────│                     │
  │ (to ws_harsha)        │                  │                     │
  │                       │◄──broadcast──────│                     │
  │                       │ (to ws_rahul)     │                     │
  │                       │                  │                     │
  │ ws.onmessage fires    │ ws.onmessage fires│                     │
  │ formatMsg(data)       │ formatMsg(data)   │                     │
  │ setChannelMessages    │ setChannelMessages│                     │
  │  (prev=>[...msg])     │  (prev=>[...msg]) │                     │
  │                       │                  │                     │
  │ React re-renders      │ React re-renders  │                     │
  │ message appears ✅    │ message appears ✅ │                     │
  │ scroll to bottom      │ scroll to bottom  │                     │
```

**Key insight:** The sender (Harsha) does NOT add the message to local state immediately. He sends it to the server, and it comes back through the WebSocket broadcast — exactly like Rahul receives it. This ensures:
- Both people see the exact same message with the same database-assigned `id` and `created_at`.
- If the network fails, Harsha won't see a phantom message that was never saved.

---

## 8. JWT Token Lifecycle

```
[Signup/Login]
    │
    ├── Backend creates JWT:
    │   payload = { "sub": "5", "exp": <24h from now> }
    │   signed with SECRET_KEY using HS256 algorithm
    │
    ├── Frontend receives token → stores in localStorage
    │
    ▼
[Every API Request]
    │
    ├── Request Interceptor reads token from localStorage
    ├── Attaches: Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiI1Ii4...
    │
    ├── Backend decodes: jwt.decode(token, SECRET_KEY, algorithms=["HS256"])
    │   → { "sub": "5", "exp": 17... }
    │   → account_id = int("5") = 5
    │
    ▼
[Token Expiry (after 24 hours)]
    │
    ├── Backend returns HTTP 401 Unauthorized
    ├── Response Interceptor catches it
    ├── localStorage.removeItem('omnibase_token')
    ├── window.location.reload()
    └── → User lands on homepage, must sign in again

[Logout]
    ├── localStorage.removeItem('omnibase_token')
    ├── localStorage.removeItem('omnibase_last_tenant')
    └── setView('landing') → back to homepage
```

**Why `sub` (subject) claim?**  
`sub` is a standard JWT claim defined in RFC 7519. It identifies who the token is about. Using the standard name makes the token compatible with JWT libraries and tools.

**Why only `account_id` in the token (not `tenant_id`)?**  
The active workspace (`tenant_id`) can change without re-login because it's stored in `account.last_active_tenant_id` in the database. The JWT is only for identity verification, not workspace context.

---

## 9. WebSocket Authentication: Why Query Param (Not Header)

Standard HTTP requests can set any header you want:
```
Authorization: Bearer eyJ...
```

But the browser's native `WebSocket` API **does not allow custom headers**. You cannot do:
```js
// THIS DOES NOT WORK:
new WebSocket('ws://...', { headers: { Authorization: '...' } })
```

The only options for WebSocket authentication are:
1. **Query parameter**: `ws://localhost:8000/ws/1?token=eyJ...` ✅ (used here)
2. **Cookie**: Send a session cookie (requires cookie-based auth setup).
3. **First message**: Send auth data as the first WebSocket message (complex to implement).

The query parameter approach is the **industry standard** for browser WebSocket auth. The token is still validated server-side — the connection is rejected with code `4001` if it's missing or invalid.

---

## 10. The Privacy Wall: How Data Isolation Works End-to-End

Every data-access route (projects, messages, users) uses `get_verified_membership`:

```python
async def get_verified_membership(
    current_account: Account = Depends(get_current_account),
    session: AsyncSession = Depends(get_session),
) -> User:
```

This dependency chain means every single tenant-scoped request must pass through 3 gates:

```
Gate 1: Is the JWT valid?
  ↓ fail → 401 Unauthorized

Gate 2: Does this account have an active tenant?
  ↓ fail → 400 Bad Request

Gate 3: Is there a User row connecting this account to that tenant?
  ↓ fail → 403 Forbidden (privacy wall)
  ↓ pass → returns User object (with role)

Route executes:
  SELECT ... WHERE tenant_id = membership.tenant_id
  ← hardcoded in the query, cannot be changed by the request body
```

**The attack this prevents:** A user logging in with account A tries to manually call `GET /projects/?tenant_id=999` to read another company's channels. This fails because:
1. The `tenant_id` is not read from the request — it's read from `account.last_active_tenant_id` in the database.
2. The `User` table check confirms they are actually a member of that tenant.

---

## 11. All Connection Points Summary

| Action | Protocol | Method | Endpoint | Auth |
|--------|----------|--------|----------|------|
| Sign Up | HTTP | POST | `/auth/signup` | None |
| Google Sign-In/Up | HTTP | POST | `/auth/google-token` | None |
| Sign In | HTTP | POST | `/accounts/login` | None |
| Load Profile | HTTP | GET | `/accounts/me` | JWT Header |
| List Workspaces | HTTP | GET | `/tenants/` | JWT Header |

| Create Workspace | HTTP | POST | `/tenants/` | JWT Header |
| List Channels | HTTP | GET | `/projects/` | JWT + Membership |
| Create Channel | HTTP | POST | `/projects/` | JWT + Membership |
| Delete Channel | HTTP | DELETE | `/projects/{id}` | JWT + Membership + Admin/Manager |
| List Members | HTTP | GET | `/users/` | JWT + Membership |
| Load Chat History | HTTP | GET | `/projects/{id}/messages` | JWT + Membership |
| Real-Time Chat | WebSocket | WS | `/ws/{project_id}?token=` | JWT in query param |

---

## 12. Local Development: Starting Everything

### Start the Backend

```bash
cd c:\projects\OmniBase\backend
.\venv\Scripts\activate
uvicorn main:app --reload
# → Running on http://localhost:8000
# → Swagger UI at http://localhost:8000/docs
```

### Start the Frontend

```bash
cd c:\projects\OmniBase\frontend
npm run dev
# → Running on http://localhost:5173
```

### Run Database Migrations

```bash
cd c:\projects\OmniBase\backend
.\venv\Scripts\python.exe -m alembic upgrade head
```

### The Ports Must Match

The Axios base URL in `api.js` is hardcoded to `http://localhost:8000`. The WebSocket URL in `Home.jsx` is hardcoded to `ws://localhost:8000`. If you run the backend on a different port, update these two places.

---

## 13. The Full Technology Stack at a Glance

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **UI Framework** | React 19 | Component-based UI |
| **Build Tool** | Vite 8 | Fast dev server + bundling |
| **Styling** | Tailwind CSS v4 | Utility-first CSS classes |
| **HTTP Client** | Axios | REST API calls with interceptors |
| **Real-Time** | Browser WebSocket API | Live bi-directional chat |
| **Backend Framework** | FastAPI | Python async API server |
| **ORM** | SQLModel | Database models + validation |
| **Database Driver** | asyncpg | Async PostgreSQL connection |
| **Database** | Neon PostgreSQL | Cloud-hosted serverless SQL DB |
| **Migrations** | Alembic | Schema versioning and upgrades |
| **Auth** | python-jose (JWT) | Stateless token authentication |
| **Password Hashing** | bcrypt | One-way password storage |
| **Secrets** | python-dotenv | Loads `.env` into environment |
