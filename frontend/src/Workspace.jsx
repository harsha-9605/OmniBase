import { useState, useEffect } from 'react'
import './Workspace.css'

function Workspace({ userEmail = 'user@example.com', onBack }) {
  const [workspaces, setWorkspaces] = useState([])
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [workspaceName, setWorkspaceName] = useState('')
  const [creating, setCreating] = useState(false)

  // Load workspaces from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem('omnibase_workspaces')
    if (stored) {
      setWorkspaces(JSON.parse(stored))
    }
  }, [])

  const getInitials = (name) => {
    return name
      .split(' ')
      .map(w => w[0])
      .join('')
      .toUpperCase()
      .slice(0, 2)
  }

  const getTimeAgo = () => {
    return 'just now'
  }

  const handleCreate = () => {
    if (!workspaceName.trim()) return
    setCreating(true)

    // Simulate creation timing delay
    setTimeout(() => {
      const newWorkspace = {
        id: Date.now().toString(),
        name: workspaceName.trim(),
        initials: getInitials(workspaceName.trim()),
        members: 1,
        lastSignIn: getTimeAgo(),
        createdAt: new Date().toISOString(),
      }
      const updated = [...workspaces, newWorkspace]
      setWorkspaces(updated)
      localStorage.setItem('omnibase_workspaces', JSON.stringify(updated))
      setWorkspaceName('')
      setShowCreateForm(false)
      setCreating(false)
    }, 800)
  }

  const accentColors = [
    'linear-gradient(135deg, #7c5cfc, #a259ff)',
    'linear-gradient(135deg, #2dd4bf, #0ea5e9)',
    'linear-gradient(135deg, #fb923c, #eab308)',
    'linear-gradient(135deg, #ec4899, #a855f7)',
    'linear-gradient(135deg, #4ade80, #22d3ee)',
  ]

  return (
    <>
      {/* Background Orbs */}
      <div className="bg-grid" aria-hidden="true" />
      <div className="bg-orb bg-orb-1" aria-hidden="true" />
      <div className="bg-orb bg-orb-2" aria-hidden="true" />

      <div className="ws-page">
        {/* Top bar */}
        <header className="ws-topbar">
          <a href="/" className="ws-logo" id="ws-logo" onClick={(e) => { e.preventDefault(); onBack() }}>
            <div className="ws-logo-icon" aria-hidden="true">⬡</div>
            OmniBase
          </a>
          <div className="ws-topbar-right">
            <span className="ws-topbar-hint">Missing something?</span>
            <button className="ws-topbar-link" id="btn-ws-signin" onClick={onBack}>Sign in to another account</button>
          </div>
        </header>

        {/* Main box */}
        <main className="ws-main">
          <div className="ws-header fade-in">
            <h1 className="ws-title" id="ws-heading">Welcome back!</h1>
            <p className="ws-subtitle">
              You can create a new workspace or choose from an existing one.
            </p>
          </div>

          <div className="ws-card-wrap">
            {!showCreateForm ? (
              <button className="ws-create-card" id="btn-create-workspace" onClick={() => setShowCreateForm(true)}>
                <span className="ws-create-plus" aria-hidden="true">+</span>
                <span className="ws-create-label">Create a new workspace</span>
              </button>
            ) : (
              <div className="ws-create-form fade-in" id="ws-create-form">
                <span className="ws-form-label">Name your workspace</span>
                <input
                  id="ws-name-input"
                  className="ws-input"
                  type="text"
                  placeholder="e.g. Acme Corp, My Team..."
                  value={workspaceName}
                  onChange={(e) => setWorkspaceName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                  autoFocus
                />
                <div className="ws-form-actions">
                  <button className="ws-btn-ghost" id="btn-cancel-create" onClick={() => { setShowCreateForm(false); setWorkspaceName('') }}>Cancel</button>
                  <button className="ws-btn-primary" id="btn-confirm-create" onClick={handleCreate} disabled={!workspaceName.trim() || creating}>
                    {creating ? <div className="ws-spinner" aria-label="Creating..." /> : 'Create workspace'}
                  </button>
                </div>
              </div>
            )}

            <p className="ws-legal" id="ws-legal">
              By continuing, you agree to our{' '}
              <a href="#" className="ws-legal-link">Main Services Agreement</a>,{' '}
              <a href="#" className="ws-legal-link">User Terms of Service</a>, and{' '}
              <a href="#" className="ws-legal-link">OmniBase Supplemental Terms</a>.
              Additional disclosures are available in our{' '}
              <a href="#" className="ws-legal-link">Privacy Policy</a> and{' '}
              <a href="#" className="ws-legal-link">Cookie Policy</a>.
            </p>
          </div>

          {/* Conditional Workspaces */}
          {workspaces.length > 0 && (
            <div className="ws-existing fade-in" id="ws-existing-section">
              <div className="ws-divider-row">
                <span className="ws-divider-line" />
                <span className="ws-divider-text">OR continue to existing workspaces</span>
                <span className="ws-divider-line" />
              </div>

              <div className="ws-ready-section" id="ws-ready-section">
                <div className="ws-ready-header">
                  <span className="ws-ready-title">Ready to launch</span>
                  <span className="ws-ready-email">{userEmail}</span>
                </div>

                <div className="ws-workspace-list" id="ws-workspace-list">
                  {workspaces.map((ws, i) => (
                    <button key={ws.id} className="ws-workspace-item" id={`btn-workspace-${ws.id}`}>
                      <div className="ws-workspace-avatar" style={{ background: accentColors[i % accentColors.length] }}>
                        {ws.initials}
                      </div>
                      <div className="ws-workspace-info">
                        <span className="ws-workspace-name">{ws.name}</span>
                        <div className="ws-workspace-meta">
                          <div className="ws-member-badge">H</div>
                          <span>{ws.members} member · Last sign-in {ws.lastSignIn}</span>
                        </div>
                      </div>
                      <svg className="ws-workspace-arrow" width="18" height="18" viewBox="0 0 18 18" fill="none">
                        <path d="M4 9h10M9 4l5 5-5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </main>

        {/* Footer */}
        <footer className="ws-footer" id="ws-footer">
          <a href="#" className="ws-footer-link">Privacy & Terms</a>
          <a href="#" className="ws-footer-link">Contact Us</a>
          <a href="#" className="ws-footer-link">Status</a>
        </footer>
      </div>
    </>
  )
}

export default Workspace
