import { useEffect, useState } from 'react'
import { Routes, Route, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import api from './api'
import SignUp from './SignUp'
import Workspace from './Workspace'
import Home from './Home'

// Derive WebSocket base URL from the HTTP API base:
// https://omnibase-backend.onrender.com  →  wss://omnibase-backend.onrender.com
// http://localhost:8000                  →  ws://localhost:8000
const _apiBase = import.meta.env.VITE_API_URL || 'http://localhost:8000'
const WS_BASE = _apiBase.replace(/^https:/, 'wss:').replace(/^http:/, 'ws:')

// ─── Auth guard ────────────────────────────────────────────────────────────
// Redirects to '/' if there is no token in localStorage.
function RequireAuth({ children }) {
  const token = localStorage.getItem('omnibase_token')
  if (!token) return <Navigate to="/" replace />
  return children
}

// ─── Shared profile loader ──────────────────────────────────────────────────
// Fetches /accounts/me once when a token is present and provides the result
// via a simple hook so child components don't duplicate the request.
function useUserProfile() {
  const [userProfile, setUserProfile] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const token = localStorage.getItem('omnibase_token')
    if (!token) {
      setLoading(false)
      return
    }
    api.get('/accounts/me')
      .then(res => setUserProfile(res.data))
      .catch(err => console.error('Failed to fetch profile', err))
      .finally(() => setLoading(false))
  }, [])

  return { userProfile, loading }
}

// ─── Landing page ───────────────────────────────────────────────────────────
const messages = [
  {
    id: 1, avatar: 'ZP', avatarColor: 'bg-brand-accent', name: 'Zara Patel',
    time: '10:42 AM', text: 'Just merged PR #128 — great work team! 🚀',
    highlight: '#128',
    card: { icon: '⑂', iconColor: 'text-brand-accent-2', title: 'feat: add user analytics dashboard', tag: 'Merged', hash: 'a1b2c3d' },
    reactions: [{ emoji: '🚀', count: 12 }, { emoji: '👏', count: 6 }, { emoji: '😊', count: null }],
  },
  { id: 2, avatar: 'EP', avatarColor: 'bg-brand-teal', name: 'Ethan Park', time: '10:45 AM', text: 'QA looks good. Moving to staging.', reactions: [] },
  { id: 3, avatar: 'GH', avatarColor: 'bg-[#1a1a2e]', avatarBorder: true, name: 'GitHub', appTag: true, time: '10:45 AM', text: 'Deployment successful ✅', link: 'View deployment', reactions: [] },
]

function LandingPage() {
  const navigate = useNavigate()

  return (
    <div className="relative min-h-screen bg-brand-bg text-text-primary overflow-x-hidden selection:bg-brand-accent/30 selection:text-white">
      <div className="absolute inset-0 bg-grid-pattern z-0 pointer-events-none opacity-40" />
      <div className="absolute top-[-200px] right-[-80px] w-[600px] h-[600px] rounded-full bg-radial from-brand-accent/20 to-transparent blur-[130px] z-0 pointer-events-none" />
      <div className="absolute bottom-[-100px] left-[-80px] w-[500px] h-[500px] rounded-full bg-radial from-brand-teal/10 to-transparent blur-[130px] z-0 pointer-events-none" />

      <nav className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between h-18 px-6 md:px-12 bg-brand-bg/80 backdrop-blur-xl border-b border-white/5" role="navigation" aria-label="Main navigation">
        <a href="/" className="flex items-center gap-2.5 font-extrabold text-xl tracking-tight text-text-primary hover:opacity-90 transition-opacity" id="logo">
          <div className="w-8 h-8 rounded-lg bg-linear-to-br from-brand-accent to-brand-accent-2 flex items-center justify-center text-sm shadow-[0_0_20px_var(--color-brand-accent-glow)] text-white" aria-hidden="true">⬡</div>
          OmniBase
        </a>
        <ul className="hidden md:flex items-center gap-1">
          {['Features', 'Pricing', 'Docs', 'Changelog'].map(item => (
            <li key={item}>
              <a href={`#${item.toLowerCase()}`} className="px-3.5 py-2 text-sm font-medium text-text-secondary hover:text-text-primary hover:bg-white/5 rounded-lg transition-all" id={`nav-${item.toLowerCase()}`}>{item}</a>
            </li>
          ))}
        </ul>
        <div className="flex items-center gap-3">
          <button className="px-4 py-2 text-sm font-medium text-text-secondary hover:text-text-primary hover:bg-white/5 rounded-lg transition-all cursor-pointer" id="btn-signin" onClick={() => navigate('/signin')}>Sign in</button>
          <button className="px-4.5 py-2 text-sm font-semibold text-white bg-brand-accent hover:bg-brand-accent/90 rounded-lg shadow-[0_0_20px_var(--color-brand-accent-glow)] hover:shadow-[0_0_32px_var(--color-brand-accent-glow)] hover:-translate-y-0.5 transition-all cursor-pointer" id="btn-get-started" onClick={() => navigate('/signup')}>Get started free</button>
        </div>
      </nav>

      <main className="relative z-10 max-w-7xl mx-auto px-6 md:px-12 pt-32 pb-20 w-full min-h-[calc(100vh-72px)] flex items-center">
        <div className="flex flex-col md:flex-row items-center gap-12 md:gap-16 w-full">
          <div className="flex-1 flex flex-col gap-6 md:gap-8 text-left min-w-0">
            <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-brand-accent-soft border border-brand-accent/30 text-brand-accent-2 text-[12.5px] font-semibold w-fit animate-fade-in-up" id="hero-badge">
              <span className="w-1.5 h-1.5 rounded-full bg-brand-accent-2 shadow-[0_0_8px_var(--color-brand-accent-2)] animate-pulse" aria-hidden="true" />
              Now in public beta
            </div>
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight leading-[1.09] text-text-primary animate-fade-in-up [animation-delay:100ms]" id="hero-title">
              Where teams,<br />
              tools, and <span className="bg-linear-to-r from-brand-accent via-brand-accent-2 to-brand-teal bg-clip-text text-transparent">AI come<br />together.</span>
            </h1>
            <p className="text-base sm:text-lg text-text-secondary leading-relaxed max-w-md animate-fade-in-up [animation-delay:200ms]" id="hero-subtitle">
              OmniBase brings your people, conversations, and tools into one place — so you can work smarter, faster, together.
            </p>
            <div className="flex items-center gap-3.5 flex-wrap animate-fade-in-up [animation-delay:320ms]">
              <button className="px-6 py-3.5 text-sm font-bold text-white bg-gradient-to-r from-brand-accent to-brand-accent-2 hover:to-[#a259ff] rounded-xl shadow-[0_0_32px_var(--color-brand-accent-glow)] hover:shadow-[0_0_48px_var(--color-brand-accent-glow)] hover:-translate-y-0.5 transition-all cursor-pointer" id="btn-cta-main" onClick={() => navigate('/signup')}>Get started for free</button>
              <button className="flex items-center gap-2 px-5 py-3.5 text-sm font-semibold text-text-secondary hover:text-text-primary border border-white/10 hover:border-white/20 hover:bg-white/4 rounded-xl transition-all cursor-pointer" id="btn-cta-sales">
                Talk to sales
                <svg className="w-3.5 h-3.5 transition-transform group-hover:translate-x-1" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                  <path d="M1 7h12M7 1l6 6-6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
            </div>
            <div className="flex gap-x-5 gap-y-3.5 flex-wrap animate-fade-in-up [animation-delay:460ms]">
              {[
                { icon: '💬', bg: 'bg-brand-accent/10', label: 'Team channels' },
                { icon: '🔌', bg: 'bg-brand-teal/10', label: 'Connect your tools' },
                { icon: '🤖', bg: 'bg-brand-orange/10', label: 'AI-powered' },
                { icon: '🔐', bg: 'bg-brand-green/10', label: 'Enterprise security' },
              ].map(f => (
                <div className="flex items-center gap-2 text-xs.5 font-medium text-text-muted" key={f.label}>
                  <span className={`w-7 h-7 rounded-lg ${f.bg} flex items-center justify-center text-[13px]`} aria-hidden="true">{f.icon}</span>
                  {f.label}
                </div>
              ))}
            </div>
          </div>

          {/* Hero Right — mock UI */}
          <div className="flex-1 w-full max-w-[520px] relative flex justify-center items-center animate-fade-in-up [animation-delay:500ms]" id="mock-ui-container">
            <div className="absolute w-[380px] h-[380px] rounded-full bg-radial from-brand-accent/18 to-transparent pointer-events-none z-0" />
            <div className="relative z-10 w-full bg-[#1a1a1a] rounded-2xl overflow-hidden border border-white/5 shadow-[0_0_0_1px_rgba(0,0,0,0.12),0_32px_80px_rgba(0,0,0,0.55),0_0_80px_rgba(124,92,252,0.15)]" id="mock-ui">
              <div className="flex h-[420px]">
                <div className="w-17 bg-[#3d1a6b] flex flex-col items-center py-3.5 gap-0.5 flex-shrink-0">
                  <div className="w-9 h-9 rounded-xl bg-white text-[#3d1a6b] text-lg font-black flex items-center justify-center mb-2.5">A</div>
                  <div className="w-9 h-[1px] bg-white/15 mb-2" />
                  {[{ icon: '🏠', label: 'Home' }, { icon: '💬', label: 'DMs' }, { icon: '🔔', label: 'Activity' }, { icon: '···', label: 'More' }].map((item) => (
                    <div key={item.label} className="flex flex-col items-center gap-0.5 py-2 w-full hover:bg-white/8 cursor-pointer transition-colors">
                      <div className="text-lg text-white/75 w-[30px] h-[30px] flex items-center justify-center">{item.icon}</div>
                      <span className="text-[9px] font-semibold text-white/70 tracking-wider">{item.label}</span>
                    </div>
                  ))}
                </div>
                <div className="flex-1 flex flex-col bg-[#1a1a1a] overflow-hidden">
                  <div className="flex items-center justify-between px-4.5 py-3 border-b border-white/8">
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-extrabold text-[#f0f0ff] tracking-tight"># project-orion</span>
                      <svg className="text-white/40" width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex -space-x-2">
                        {['ZP','EP','AM'].map((a, i) => (
                          <div key={i} className="w-5.5 h-5.5 rounded-full bg-gradient-to-br from-brand-accent to-brand-accent-2 border-2 border-[#1a1a1a] text-[7px] font-extrabold text-white flex items-center justify-center">{a}</div>
                        ))}
                      </div>
                      <span className="text-[12px] font-bold text-white/50">32</span>
                      <span className="text-sm text-white/35 cursor-pointer hover:text-white/70 ml-1">···</span>
                    </div>
                  </div>
                  <div className="flex-1 overflow-y-auto py-3.5 flex flex-col gap-0.5">
                    {messages.map(msg => (
                      <div key={msg.id} className="flex items-start gap-2.5 px-4.5 py-2 hover:bg-white/4 transition-colors">
                        <div className={`w-8 h-8 rounded-lg ${msg.id === 3 ? 'border border-[#444]' : msg.avatarColor} text-white text-[11px] font-extrabold flex items-center justify-center flex-shrink-0 mt-0.5`}>
                          {msg.id === 3 ? '⑂' : msg.avatar}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 mb-0.5">
                            <span className="text-xs.5 font-extrabold text-[#f0f0ff]">{msg.name}</span>
                            {msg.appTag && <span className="text-[9px] font-bold px-1.5 py-0.5 bg-white/10 text-white/50 rounded">APP</span>}
                            <span className="text-[10.5px] text-white/30">{msg.time}</span>
                          </div>
                          <p className="text-xs.5 text-text-secondary leading-relaxed">
                            {msg.highlight ? (<>Just merged PR <span className="text-brand-accent-2 font-semibold hover:underline cursor-pointer">{msg.highlight}</span> — great work team! 🚀</>) : msg.text}
                            {msg.link && <span className="text-brand-accent-2 font-semibold hover:underline cursor-pointer ml-1">{msg.link}</span>}
                          </p>
                          {msg.card && (
                            <div className="mt-2.5 p-3 bg-brand-accent/8 border border-brand-accent/25 border-l-3 border-l-brand-accent rounded-lg flex items-start gap-2.5 backdrop-blur-md">
                              <span className="text-xl leading-none text-brand-accent-2">⑂</span>
                              <div className="flex-1">
                                <p className="text-xs.5 font-bold text-[#e0e0f0] mb-1.5">{msg.card.title}</p>
                                <div className="flex items-center gap-2">
                                  <span className="inline-flex items-center gap-1 text-[10.5px] font-bold px-2 py-0.5 bg-brand-green/15 text-brand-green rounded-md">✓ {msg.card.tag}</span>
                                  <span className="text-[11px] text-white/35 font-mono">{msg.card.hash}</span>
                                </div>
                              </div>
                            </div>
                          )}
                          {msg.reactions.length > 0 && (
                            <div className="flex gap-1.5 mt-2 flex-wrap">
                              {msg.reactions.map((r, i) => (
                                <span key={i} className={`inline-flex items-center gap-1 px-2 py-0.75 bg-brand-accent/15 border border-brand-accent/30 rounded-xl text-xs text-text-secondary hover:bg-brand-accent/25 transition-colors cursor-pointer ${r.count === null ? 'bg-transparent border-white/12 text-white/30' : ''}`}>
                                  {r.emoji}{r.count !== null && ` ${r.count}`}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="px-4 py-2.5 border-t border-white/7 bg-[#1a1a1a]">
                    <div className="border border-white/12 bg-white/4 rounded-lg px-3.5 py-2.25 mb-2 flex items-center">
                      <span className="text-xs.5 text-white/25">Message #project-orion</span>
                    </div>
                    <div className="flex items-center gap-3 px-0.5">
                      {['+', 'Aa', '😊', '@', '📹', '🎙'].map(icon => (
                        <span key={icon} className="text-xs.5 text-white/35 hover:text-white/70 cursor-pointer transition-colors">{icon}</span>
                      ))}
                      <span className="ml-auto text-xs.5 text-white/25 cursor-pointer">➤</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>

      <section className="relative z-10 border-t border-white/5 py-13 px-6 md:px-12 w-full max-w-7xl mx-auto text-center" aria-label="Trusted by">
        <p className="text-[11px] font-bold tracking-widest uppercase text-text-muted mb-8">Trusted by forward-thinking teams</p>
        <div className="flex items-center justify-center gap-x-13 gap-y-6 flex-wrap">
          {['Airbnb', 'NASA', 'Spotify', 'Uber', 'Target', 'Canva'].map(name => (
            <span className="text-[17px] font-extrabold text-text-muted hover:text-text-secondary tracking-tight select-none transition-colors cursor-default" key={name}>{name}</span>
          ))}
        </div>
      </section>
    </div>
  )
}

// ─── Global WebSocket Listener ────────────────────────────────────────────────
function GlobalWebSocketListener({ userProfile }) {
  const [inviteModal, setInviteModal] = useState(null)
  const navigate = useNavigate()

  useEffect(() => {
    const token = localStorage.getItem('omnibase_token')
    if (!token || !userProfile) return

    const wsUrl = `${WS_BASE}/ws/0?token=${encodeURIComponent(token)}`
    const ws = new WebSocket(wsUrl)

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        if (data.type === 'INVITE_RECEIVED') {
          setInviteModal(data)
        }
      } catch (err) {
        console.error('Failed to parse global websocket message', err)
      }
    }

    return () => {
      ws.close()
    }
  }, [userProfile])

  const handleAccept = async () => {
    try {
      const res = await api.post('/api/invite/accept', { workspace_name: inviteModal.workspace_name })
      const newTenantId = res.data.tenant_id
      setInviteModal(null)
      if (newTenantId) {
        localStorage.setItem('omnibase_last_tenant', newTenantId.toString())
        // Hard reload or navigate to refresh contexts
        window.location.assign('/workspace/' + newTenantId)
      }
    } catch (err) {
      console.error('Failed to accept invite', err)
      alert("Failed to accept invitation.")
    }
  }

  if (!inviteModal) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm px-4">
      <div className="bg-[#1e1e1e] border border-white/10 rounded-xl p-6 shadow-2xl max-w-sm w-full animate-fade-in-up">
        <h3 className="text-xl font-bold text-white mb-2">Workspace Invitation</h3>
        <p className="text-text-secondary text-sm mb-6">
          <span className="font-semibold text-white">{inviteModal.invited_by}</span> has invited you to join the <span className="font-semibold text-white">{inviteModal.workspace_name}</span> workspace.
        </p>
        <div className="flex items-center gap-3 justify-end">
          <button 
            className="px-4 py-2 text-sm font-medium text-text-secondary hover:text-white hover:bg-white/10 rounded-lg transition-colors cursor-pointer"
            onClick={() => setInviteModal(null)}
          >
            Decline
          </button>
          <button 
            className="px-4 py-2 text-sm font-semibold text-white bg-brand-accent hover:bg-brand-accent/90 rounded-lg shadow-[0_0_15px_var(--color-brand-accent-glow)] transition-all cursor-pointer"
            onClick={handleAccept}
          >
            Accept
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Invite Handler Route ───────────────────────────────────────────────────
function InviteHandler() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const [status, setStatus] = useState('Processing invitation...')

  useEffect(() => {
    const ws = searchParams.get('ws')
    if (!ws) {
      navigate('/', { replace: true })
      return
    }

    const token = localStorage.getItem('omnibase_token')
    if (!token) {
      // Not logged in, redirect to signup page with parameters
      navigate(`/signup?ws=${encodeURIComponent(ws)}`, { replace: true })
      return
    }

    // Logged in, automatically accept the invite
    api.post('/api/invite/accept', { workspace_name: ws })
      .then(res => {
        const tenantId = res.data.tenant_id
        if (tenantId) {
          localStorage.setItem('omnibase_last_tenant', tenantId.toString())
          // Redirect to workspace
          window.location.assign('/workspace/' + tenantId)
        } else {
          navigate('/workspaces', { replace: true })
        }
      })
      .catch(err => {
        console.error("Failed to accept invite", err)
        setStatus('Failed to accept invitation. The link might be expired or workspace not found.')
        setTimeout(() => {
          navigate('/workspaces', { replace: true })
        }, 3000)
      })
  }, [searchParams, navigate])

  return (
    <div className="min-h-screen bg-brand-bg text-white flex items-center justify-center p-4">
      <div className="bg-[#16161f] border border-white/8 rounded-2xl p-8 shadow-2xl max-w-sm w-full text-center">
        <div className="w-10 h-10 border-2 border-brand-accent border-t-transparent rounded-full animate-spin mx-auto mb-4" />
        <p className="text-sm font-medium text-text-secondary">{status}</p>
      </div>
    </div>
  )
}

// ─── Root App with Routes ───────────────────────────────────────────────────
function App() {
  const { userProfile, loading } = useUserProfile()
  const token = localStorage.getItem('omnibase_token')

  if (loading) {
    return <div className="min-h-screen bg-brand-bg text-white flex items-center justify-center">Loading...</div>
  }

  return (
    <>
      <GlobalWebSocketListener userProfile={userProfile} />
      <Routes>
        {/* Public routes */}
        <Route path="/" element={
          // If already signed in, redirect straight to workspace selector
          token ? <Navigate to="/workspaces" replace /> : <LandingPage />
        } />

        <Route path="/invite" element={<InviteHandler />} />

        <Route path="/signup" element={
          token ? <Navigate to="/workspaces" replace /> : <SignUp mode="signup" />
        } />

        <Route path="/signin" element={
          token ? <Navigate to="/workspaces" replace /> : <SignUp mode="signin" />
        } />

        {/* Protected routes */}
        <Route path="/workspaces" element={
          <RequireAuth>
            <Workspace 
              userProfile={userProfile} 
              onBack={() => {
                localStorage.removeItem('omnibase_token');
                window.location.href = '/signin';
              }} 
              onLogout={() => {
                localStorage.removeItem('omnibase_token');
                window.location.href = '/';
              }}
            />
          </RequireAuth>
        } />

        {/* Workspace routes with optional channel/DM paths */}
        <Route path="/workspace/:tenantId" element={
          <RequireAuth>
            <Home userProfile={userProfile} />
          </RequireAuth>
        } />
        <Route path="/workspace/:tenantId/c/:projectId" element={
          <RequireAuth>
            <Home userProfile={userProfile} />
          </RequireAuth>
        } />
        <Route path="/workspace/:tenantId/dm/:accountId" element={
          <RequireAuth>
            <Home userProfile={userProfile} />
          </RequireAuth>
        } />

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  )
}

export default App
