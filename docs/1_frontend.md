# OmniBase — Frontend Documentation

> **Stack**: React 19 + Vite 8 + Tailwind CSS v4 + Axios + Native WebSocket API  
> **Location**: `c:\projects\OmniBase\frontend\`  
> **Dev Command**: `npm run dev` (runs on `http://localhost:5173`)

---

## 1. Project Structure

```
frontend/
├── public/
├── src/
│   ├── App.jsx           ← Root component. Controls which view (screen) to show.
│   ├── SignUp.jsx        ← Auth page — handles both Sign Up and Sign In forms.
│   ├── Workspace.jsx     ← Workspace selector + 3-step creation wizard.
│   ├── Home.jsx          ← The main dashboard. Channels, chat, DMs, modals.
│   ├── api.js            ← Axios instance with interceptors.
│   ├── index.css         ← Global design system (CSS variables, animations).
│   └── main.jsx          ← ReactDOM entry point.
├── package.json
└── vite.config.js
```

---

## 2. Framework & Build Tool

### React 19
- Used for building the entire UI with a component-based architecture.
- Uses **functional components** — no class components anywhere.
- All state is managed with React **hooks**: `useState`, `useEffect`, `useRef`, `useCallback`.

### Vite 8
- Used instead of Create React App because it is much faster.
- Provides Hot Module Replacement (HMR) — changes appear in the browser instantly without a full reload.
- Build command: `npm run build` — outputs optimized static files to `dist/`.

### Tailwind CSS v4
- Used for **all styling**. No separate `.css` files for individual components.
- Utility-first: styles are written directly as class names on HTML elements.
- Custom design tokens are defined in `index.css` using CSS variables:
  - `--color-brand-accent` → purple `#7c5cfc`
  - `--color-brand-teal` → `#2dd4bf`
  - `--color-brand-bg` → dark background
- Animations like `animate-fade-in-up` are defined as custom keyframes in `index.css`.

---

## 3. Component Breakdown

### `App.jsx` — Root / Router

This is the **single-page application controller**. There is no React Router — navigation is controlled entirely by a `view` state variable.

**View States:**
```
'landing'   → Shows the marketing landing page with hero section
'signup'    → Shows SignUp component in signup mode
'signin'    → Shows SignUp component in signin mode
'workspace' → Shows Workspace → which eventually shows Home
```

**How the view switches:**
```jsx
const [view, setView] = useState(() => {
  if (localStorage.getItem('omnibase_token')) return 'workspace'
  return 'landing'
})
```
- On first load, it checks if there is a JWT token in `localStorage`.
- If token exists → goes directly to `'workspace'` (user is already logged in).
- If no token → shows `'landing'` (marketing page).

**Authentication Guard (useEffect):**
```jsx
useEffect(() => {
  localStorage.removeItem('omnibase_active_ws')  // cleanup old mock keys
  localStorage.removeItem('omnibase_workspaces')

  const fetchProfile = async () => {
    if (localStorage.getItem('omnibase_token')) {
      const res = await api.get('/accounts/me')
      setUserProfile(res.data)
    }
  }
  fetchProfile()
}, [])
```
- Runs once when the app starts.
- Calls `GET /accounts/me` to load the user's name and email from the database.
- Stores the result in `userProfile` state and passes it down to child components.

**Logout:**
```jsx
onBack={() => {
  localStorage.removeItem('omnibase_token')
  localStorage.removeItem('omnibase_last_tenant')
  setView('landing')
}}
```
- Clears the JWT token and the last active workspace ID.
- Returns to the landing page.

**Landing Page Hero:**
- The landing page is a full marketing page inside `App.jsx`.
- Contains a fixed navbar, hero section with a mock UI preview of the product, feature badges, and a trust banner.
- The mock UI is **hardcoded JSX** — it's just a visual demo, not connected to the backend.

---

### `SignUp.jsx` — Authentication Form

Handles **both Sign Up and Sign In** in the same component using a `mode` prop.

**State:**
```js
const [name, setName]         = useState('')  // only used in signup mode
const [email, setEmail]       = useState('')
const [password, setPassword] = useState('')
const [error, setError]       = useState('')  // shows error message below form
const [loading, setLoading]   = useState(false) // disables button during API call
```

**Sign Up Flow:**
1. User fills in Name, Email, Password.
2. On submit → calls `api.post('/auth/signup', { name, email, password })`.
3. Backend returns `{ access_token, name, email, tenant_id, tenant_name }`.
4. `access_token` is saved to `localStorage.setItem('omnibase_token', token)`.
5. `tenant_id` is saved to `localStorage.setItem('omnibase_last_tenant', ...)`.
6. Calls `onContinue({ name, email })` to pass the profile up to `App.jsx`.
7. `App.jsx` sets view to `'workspace'` → user enters the dashboard.

**Sign In Flow:**
1. User fills in Email, Password (Name field is hidden for signin).
2. On submit → calls `api.post('/accounts/login', { email, password })`.
3. Same token saving process as signup.

**Error Handling:**
```jsx
setError(err.response?.data?.detail || 'An error occurred. Please try again.')
```
- Uses optional chaining to safely extract the `detail` field from the FastAPI error response.

**Key Design Decisions:**
- The name field (`input#auth-name`) only appears when `!isSignIn`.
- The submit button shows `'Processing...'` while loading and is `disabled={loading}`.
- **Google Sign-In is fully integrated**: Powered by `@react-oauth/google`. The GitHub login remains a placeholder for future extension.

---

### Google OAuth Integration

The application supports seamless, single-click sign-in and sign-up using the official Google OAuth 2.0 flow.

#### A. Global Provider Setup (`main.jsx`)
In the entrypoint [main.jsx](file:///c:/projects/OmniBase/frontend/src/main.jsx), the application is wrapped in the `<GoogleOAuthProvider>` component:
```jsx
import { GoogleOAuthProvider } from '@react-oauth/google'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <GoogleOAuthProvider clientId={import.meta.env.VITE_GOOGLE_CLIENT_ID}>
      <App />
    </GoogleOAuthProvider>
  </StrictMode>,
)
```
*   `VITE_GOOGLE_CLIENT_ID`: Stored locally inside the [frontend/.env](file:///c:/projects/OmniBase/frontend/.env) file. Vite injects this public client ID into the application at build time.

#### B. Component Wiring (`SignUp.jsx`)
The "Continue with Google" button is connected using the `useGoogleLogin` hook:
```javascript
const handleGoogleLogin = useGoogleLogin({
  onSuccess: async (tokenResponse) => {
    setGoogleLoading(true)
    try {
      // 1. Fetch user email and name directly from Google's secure profile endpoint
      const userInfoRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${tokenResponse.access_token}` }
      })
      const userInfo = await userInfoRes.json()
      
      // 2. Transmit to backend for token verification & auto-provisioning
      const res = await api.post('/auth/google-token', {
        access_token: tokenResponse.access_token,
        name: userInfo.name,
        email: userInfo.email,
      })
      
      // 3. Save OmniBase session JWT and active workspace locally
      const { access_token, name: userName, email: userEmail, tenant_id } = res.data
      localStorage.setItem('omnibase_token', access_token)
      if (tenant_id) localStorage.setItem('omnibase_last_tenant', tenant_id.toString())
      
      // 4. Update parent profile state and enter dashboard view
      onContinue({ name: userName, email: userEmail })
    } catch (err) {
      setError(err.response?.data?.detail || 'Google sign-in failed. Please try again.')
    } finally {
      setGoogleLoading(false)
    }
  },
  flow: 'implicit'
})
```
*   **Implicit Flow**: Retrieves a secure `access_token` on the client side, fetches user profiles, and presents them to the backend server.
*   **Auto-Provisioning**: If it is a new user, the backend atomically constructs a new Workspace (named after the user), an Admin Membership, a `#general` channel, and switches the view directly.

---


### `Workspace.jsx` — Workspace Selector + Creation Wizard

This component shows after login. It either shows:
1. The **workspace selector** (if no active workspace).
2. The **Home dashboard** (if an active workspace is selected).
3. The **3-step creation wizard** (if the user clicks "Create new workspace").

**State:**
```js
const [workspaces, setWorkspaces]   = useState([])     // list of tenants from backend
const [loading, setLoading]         = useState(true)    // shows loading screen
const [activeWs, setActiveWs]       = useState(...)     // currently selected workspace ID
const [showCreateForm, ...]         // whether wizard is open
const [wizardStep, ...]             // 1, 2, or 3
const [workspaceName, ...]          // input for new workspace name
const [teammateEmails, ...]         // comma-separated email list
```

**Data Fetching on Mount:**
```jsx
useEffect(() => {
  const fetchWorkspaces = async () => {
    const res = await api.get('/tenants/')
    setWorkspaces(res.data)
    // Auto-select first workspace if none is active
    if (!activeWs && res.data.length > 0) {
      setActiveWs(res.data[0].id.toString())
    }
  }
  fetchWorkspaces()
}, [])
```
- Calls `GET /tenants/` to get all workspaces the logged-in user is a member of.
- If the user has only one workspace (typical for new users), auto-selects it.

**Routing to Home:**
```jsx
if (activeWs) {
  const wsData = workspaces.find(w => w.id.toString() === activeWs.toString())
  return <Home
    tenantId={activeWs}
    workspaceName={wsData?.name || 'Workspace'}
    userProfile={userProfile}
    onBack={() => { setActiveWs(null); }}
  />
}
```
- When `activeWs` is set, Workspace renders the `Home` component instead of itself.
- Passes down `tenantId`, `workspaceName`, and `userProfile` as props.

**Creating a New Workspace:**
```jsx
const handleFinishCreation = async () => {
  // Step 1: POST /tenants/ → creates the tenant/workspace
  const tenantRes = await api.post('/tenants/', { name, slug })
  // Step 2: POST /projects/ → creates a default 'general' channel
  await api.post('/projects/', { name: 'general', description: 'General discussions' })
  // Step 3: Update local state and navigate to new workspace
  setActiveWs(newTenant.id.toString())
}
```

**The 3-Step Wizard:**
- Step 1: Enter workspace name — live preview panel on the right shows the name updating.
- Step 2: Enter your display name.
- Step 3: Enter teammate email addresses (comma-separated), copy invite link.
- "Create Workspace" button triggers `handleFinishCreation`.

---

### `Home.jsx` — The Main Dashboard

This is the largest and most complex component (~1000 lines). It renders the full Slack-style workspace UI.

**Props it receives:**
```js
{ tenantId, workspaceName, userProfile, onBack }
```

**Derived values at the top:**
```js
const wsInitials = wsName.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
const ownerName = userProfile?.name || 'Team Member'
const dynamicAllChannelName = 'all-' + wsName.toLowerCase().replace(/\s+/g, '-')
```

#### A. Data Fetching (useEffect)

```jsx
useEffect(() => {
  const fetchChannelsAndUsers = async () => {
    const [channelsRes, usersRes] = await Promise.all([
      api.get('/projects/'),
      api.get('/users/')
    ])
    // Map channels
    setChannels(channelsRes.data.map(p => ({ id: p.id.toString(), name: p.name })))
    // Auto-connect to first channel
    switchChannel(first.id, first.name)
    // Filter self out from DM list
    setInvitedList(usersRes.data.filter(u => u.email !== userProfile?.email))
  }
  fetchChannelsAndUsers()
}, [tenantId])
```
- Uses `Promise.all` to fetch channels and users **simultaneously** (faster than sequential).
- Auto-connects to the first channel's WebSocket when the dashboard loads.

#### B. WebSocket Chat System

**Refs used:**
```js
const wsRef = useRef(null)        // holds the live WebSocket object
const messagesEndRef = useRef(null) // used to scroll to bottom
```

**`switchChannel` function:**
This is the most critical function. Called when the user clicks any channel.

```jsx
const switchChannel = useCallback(async (projectId, channelName) => {
  // 1. Close old WebSocket cleanly
  if (wsRef.current) {
    wsRef.current.onclose = null
    wsRef.current.close()
    wsRef.current = null
  }

  setActiveChannel('# ' + channelName)
  setActiveProjectId(projectId)
  setChannelMessages([])

  // 2. Load chat history from REST API
  const res = await api.get(`/projects/${projectId}/messages`)
  setChannelMessages(res.data.map(formatMsg))

  // 3. Open new WebSocket for this channel
  const token = localStorage.getItem('omnibase_token')
  const wsUrl = `ws://localhost:8000/ws/${projectId}?token=${token}`
  const ws = new WebSocket(wsUrl)

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data)
    setChannelMessages(prev => [...prev, formatMsg(msg)])
  }

  wsRef.current = ws
}, [])
```

**`formatMsg` helper:**
Maps the raw database shape to the UI display shape:
```js
const formatMsg = (m) => ({
  id: m.id,
  sender: m.sender_name,
  initials: m.sender_name ? m.sender_name[0].toUpperCase() : '?',
  time: new Date(m.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
  text: m.content,
})
```

**`handleSendMessage`:**
```js
const handleSendMessage = () => {
  if (!newMessageText.trim() || wsRef.current.readyState !== WebSocket.OPEN) return
  wsRef.current.send(JSON.stringify({ content: newMessageText.trim() }))
  setNewMessageText('')
}
```
- Does NOT update local state immediately.
- Sends JSON down the WebSocket → backend saves + broadcasts → message comes back through `ws.onmessage` → appended to state.
- This means the sender's own message goes through the same pipeline as other viewers — true consistency.

**Auto-scroll:**
```jsx
useEffect(() => {
  messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
}, [channelMessages])
```
Triggers every time `channelMessages` changes (new message arrives), smoothly scrolls to bottom.

**Cleanup on unmount:**
```jsx
useEffect(() => {
  return () => {
    if (wsRef.current) {
      wsRef.current.onclose = null
      wsRef.current.close()
    }
  }
}, [])
```
Ensures the WebSocket connection is properly closed when the user navigates away.

#### C. UI Layout Structure

```
<div> (full screen fixed overlay)
  ├── <aside> Left Sidebar (320px wide)
  │   ├── Workspace header (name + chevron dropdown)
  │   ├── Top icon bar (Home, DMs, Activity, More)
  │   ├── Favourites section (drag-and-drop from channels)
  │   ├── Channels section (maps `channels` state array)
  │   ├── Direct Messages section (maps `invitedList`)
  │   ├── Apps section
  │   └── Footer user profile bar
  ├── <main> Center Content Area (flex-1)
  │   ├── Top toolbar (search bar, people button, bell, etc.)
  │   ├── Channel header (channel name, description)
  │   ├── Tab bar (Messages, Add Canvas, +)
  │   ├── Scrollable message area
  │   │   ├── Welcome block (dynamic based on activeChannel)
  │   │   ├── "Today" divider badge
  │   │   └── Messages loop + auto-scroll anchor <div ref={messagesEndRef}>
  │   └── Rich text chat input box (formatting toolbar + textarea + send button)
  └── <aside> Right Sidebar (320px, conditionally shown)
      └── Member profile details
```

#### D. Drag-and-Drop for Favourites

```jsx
draggable
onDragStart={() => setDraggedChannel(c)}
onDragEnd={() => setDraggedChannel(null)}
```
On the drop zone (Favourites section):
```jsx
onDragOver={(e) => { e.preventDefault(); setIsDragOverFav(true) }}
onDrop={() => {
  if (draggedChannel) {
    setFavourites(prev => [...prev, draggedChannel])
    setChannels(prev => prev.filter(ch => ch.id !== draggedChannel.id))
  }
}}
```

#### E. Modals

**Invite Modal** — triggered by "+ Invite people" button:
- Text area where you type comma-separated emails.
- On submit → adds emails to `invitedList` state (not yet connected to backend invite route).

**Channel Details Modal** — triggered by People icon in the toolbar:
- Shows member count, search bar, list of all members (from `invitedList`).
- Has tabs: About, Members, Tabs, Integrations, Settings.

---

## 4. `api.js` — Axios Configuration

```js
import axios from 'axios'

const api = axios.create({
  baseURL: 'http://localhost:8000',
})
```

Creates a **pre-configured Axios instance** so you don't have to type the base URL on every request.

### Request Interceptor
```js
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('omnibase_token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})
```
- Runs **before every single API call** automatically.
- Reads the JWT from localStorage and attaches it as a `Bearer` token.
- This means you never have to manually add the auth header anywhere else in the code.

### Response Interceptor
```js
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('omnibase_token')
      window.location.reload()
    }
    return Promise.reject(error)
  }
)
```
- If the backend returns a `401 Unauthorized` (expired/invalid token), automatically:
  1. Clears the bad token from localStorage.
  2. Reloads the page (which sends the user back to the landing page).

---

## 5. localStorage Keys Used

| Key | Value | Purpose |
|-----|-------|---------|
| `omnibase_token` | JWT string | Stores the authentication token |
| `omnibase_last_tenant` | Tenant ID (string) | Remembers which workspace was last active |

**Cleaned up / deprecated:**
| Key | Status |
|-----|--------|
| `omnibase_active_ws` | Removed on startup — was old mock data |
| `omnibase_workspaces` | Removed on startup — was old mock data |

---

## 6. Key React Patterns Used

| Pattern | Where | Why |
|---------|-------|-----|
| `useState` with lazy initializer | `App.jsx`, `Workspace.jsx` | Check localStorage synchronously on first render only |
| `useEffect` with `[]` dependency | `App.jsx`, `Workspace.jsx`, `Home.jsx` | Run once on mount (like componentDidMount) |
| `useRef` | `Home.jsx` | Hold WebSocket and scroll anchor — values that don't cause re-renders |
| `useCallback` | `Home.jsx` | Memoize `switchChannel` to prevent it recreating on every render |
| `Promise.all` | `Home.jsx` | Parallel API calls (faster than sequential) |
| Conditional rendering with `if` blocks | `App.jsx`, `Workspace.jsx` | Return different components based on view state |

---

## 7. Key Design Decisions

1. **No React Router** — Navigation is controlled by a single `view` state string in `App.jsx`. Simple enough for this SPA structure.
2. **No Redux / Zustand** — All state is local per-component. `userProfile` is prop-drilled from `App` → `Workspace` → `Home`.
3. **WebSocket messages are NOT added optimistically** — The sender's message goes through the server and comes back, ensuring consistency with database-assigned `id` and `created_at` timestamps.
4. **One WebSocket per channel** — When you click a different channel, the old socket is closed and a new one opens. Clean, simple lifecycle.
5. **Tailwind v4** — Uses the new CSS-first configuration (variables in CSS, not `tailwind.config.js`).
