import { useState, useEffect } from 'react'
import Home from './Home'

import api from './api'

function Workspace({ userProfile, onBack }) {
  const [workspaces, setWorkspaces] = useState([])
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [loading, setLoading] = useState(true)
  
  // Active Immersive Dashboard View State
  const [activeWs, setActiveWs] = useState(() => {
    return localStorage.getItem('omnibase_last_tenant') || null
  })
  
  // Wizard States
  const [wizardStep, setWizardStep] = useState(1)
  const [workspaceName, setWorkspaceName] = useState('')
  const [userName, setUserName] = useState('')
  const [teammateEmails, setTeammateEmails] = useState('')
  const [creating, setCreating] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    const fetchWorkspaces = async () => {
      try {
        const res = await api.get('/tenants/')
        setWorkspaces(res.data)
        
        // If there is no active workspace selected, but they have workspaces, select the first one
        if (!activeWs && res.data.length > 0) {
          const firstTenant = res.data[0].id.toString();
          setActiveWs(firstTenant)
          localStorage.setItem('omnibase_last_tenant', firstTenant)
        }
      } catch (err) {
        console.error("Failed to fetch workspaces", err)
      } finally {
        setLoading(false)
      }
    }
    fetchWorkspaces()
  }, [])

  const getInitials = (name) => {
    return name
      .split(' ')
      .map(w => w[0])
      .join('')
      .toUpperCase()
      .slice(0, 2)
  }

  const handleFinishCreation = async () => {
    const finalWsName = workspaceName.trim() || 'My Workspace'
    setCreating(true)

    try {
      // 1. Create the tenant
      const tenantRes = await api.post('/tenants/', {
        name: finalWsName,
        slug: finalWsName.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + Date.now()
      })
      const newTenant = tenantRes.data

      // 2. Add members if any
      const emails = teammateEmails.split(',').map(e => e.trim()).filter(Boolean)
      // Since we don't have a bulk invite route yet or user creation by email, 
      // we will just skip this for the API and let it be handled later inside the dashboard

      // 3. Create a default project for this new workspace
      // The backend /projects/ creates it in the *active* tenant context.
      // The active tenant was just updated when we created the tenant.
      await api.post('/projects/', {
        name: 'general',
        description: 'General discussions'
      })

      // Update local state
      setWorkspaces([...workspaces, newTenant])
      localStorage.setItem('omnibase_last_tenant', newTenant.id.toString())
      setActiveWs(newTenant.id.toString())

      // Reset wizard
      setWorkspaceName('')
      setUserName('')
      setTeammateEmails('')
      setWizardStep(1)
      setShowCreateForm(false)
    } catch (err) {
      console.error("Failed to create workspace", err)
    } finally {
      setCreating(false)
    }
  }

  const accentColors = [
    'linear-gradient(135deg, #7c5cfc, #a259ff)',
    'linear-gradient(135deg, #2dd4bf, #0ea5e9)',
    'linear-gradient(135deg, #fb923c, #eab308)',
    'linear-gradient(135deg, #ec4899, #a855f7)',
    'linear-gradient(135deg, #4ade80, #22d3ee)',
  ]

  // Immersive Home Page Dashboard View perfectly matching user screenshots
  if (activeWs) {
    const wsData = workspaces.find(w => w.id.toString() === activeWs.toString())
    return <Home tenantId={activeWs} workspaceName={wsData?.name || 'Workspace'} userProfile={userProfile} onBack={() => {
      setActiveWs(null);
      localStorage.removeItem('omnibase_last_tenant');
    }} />
  }

  if (loading) {
    return <div className="min-h-screen bg-brand-bg text-white flex items-center justify-center">Loading...</div>
  }

  // State 1 & 2: Landing setup framework flow
  return (
    <div className="relative min-h-screen bg-brand-bg text-text-primary overflow-x-hidden flex flex-col items-center w-full selection:bg-brand-accent/30 selection:text-white">
      {/* Ambient Background Effects */}
      <div className="absolute inset-0 bg-grid-pattern z-0 pointer-events-none opacity-40" />
      <div className="absolute top-[-200px] right-[-80px] w-[600px] h-[600px] rounded-full bg-radial from-brand-accent/20 to-transparent blur-[130px] z-0 pointer-events-none" />
      <div className="absolute bottom-[-100px] left-[-80px] w-[500px] h-[500px] rounded-full bg-radial from-brand-teal/10 to-transparent blur-[130px] z-0 pointer-events-none" />

      {/* Header Bar */}
      <header className="w-full flex items-center justify-between py-5 px-6 sm:px-10 relative z-10 max-w-7xl mx-auto">
        <a 
          href="/" 
          onClick={(e) => { e.preventDefault(); onBack(); }}
          className="flex items-center gap-2.5 font-extrabold text-xl tracking-tight text-text-primary hover:opacity-80 transition-opacity cursor-pointer"
        >
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-brand-accent to-brand-accent-2 flex items-center justify-center text-base shadow-[0_0_18px_var(--color-brand-accent-glow)] text-white">⬡</div>
          OmniBase
        </a>
        <div className="flex flex-col items-end gap-0.5">
          <span className="text-xs text-text-muted">Missing something?</span>
          <button 
            onClick={onBack}
            className="text-[12.5px] font-semibold text-brand-accent-2 hover:text-purple-300 bg-transparent border-none cursor-pointer transition-colors p-0"
          >
            Sign in to another account
          </button>
        </div>
      </header>

      {/* Main Content View */}
      <main className="flex-1 flex flex-col items-center justify-center w-full px-4 sm:px-6 py-8 relative z-10 max-w-7xl mx-auto">
        
        {/* State 1: Dashboard / Workspace Selection List */}
        {!showCreateForm ? (
          <div className="w-full max-w-[560px] flex flex-col items-center animate-fade-in-up">
            <div className="text-center mb-8">
              <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-text-primary mb-2.5">Welcome back!</h1>
              <p className="text-[14.5px] text-text-secondary leading-relaxed">
                You can create a new workspace or choose from an existing one.
              </p>
            </div>

            <div className="w-full flex flex-col gap-4">
              <button 
                onClick={() => { setShowCreateForm(true); setWizardStep(1); }}
                className="w-full flex items-center justify-center gap-3.5 p-5 sm:p-6 bg-white/4 border border-white/10 hover:bg-brand-accent/8 hover:border-brand-accent/35 rounded-xl cursor-pointer transition-all hover:-translate-y-0.5 group"
              >
                <span className="w-8 h-8 rounded-full border-2 border-white/30 group-hover:border-brand-accent-2 text-white/70 group-hover:text-brand-accent-2 text-xl flex items-center justify-center shrink-0 transition-colors">+</span>
                <span className="text-[15px] font-bold text-[#c8c8d8] group-hover:text-text-primary transition-colors">Create a new workspace</span>
              </button>

              <p className="text-[11.5px] text-text-muted text-center leading-relaxed mt-2">
                By continuing, you agree to our{' '}
                <a href="#" className="text-[#6b5fa0] hover:text-brand-accent-2 underline underline-offset-2 transition-colors">Main Services Agreement</a>,{' '}
                <a href="#" className="text-[#6b5fa0] hover:text-brand-accent-2 underline underline-offset-2 transition-colors">User Terms of Service</a>, and{' '}
                <a href="#" className="text-[#6b5fa0] hover:text-brand-accent-2 underline underline-offset-2 transition-colors">OmniBase Supplemental Terms</a>.
              </p>
            </div>

            {/* Existing Workspaces List */}
            {workspaces.length > 0 && (
              <div className="w-full flex flex-col items-center mt-8 animate-fade-in-up">
                <div className="w-full flex items-center gap-3 my-6">
                  <span className="flex-1 h-[1px] bg-white/7" />
                  <span className="text-xs font-semibold text-text-muted whitespace-nowrap tracking-wide">OR continue to existing workspaces</span>
                  <span className="flex-1 h-[1px] bg-white/7" />
                </div>

                <div className="w-full text-left">
                  <div className="flex flex-col gap-0.5 mb-3">
                    <span className="text-sm font-extrabold text-text-primary">Ready to launch</span>
                    <span className="text-[12.5px] text-text-muted">{userProfile?.email || 'User'}</span>
                  </div>

                  <div className="flex flex-col gap-2 w-full">
                    {workspaces.map((ws, i) => (
                      <button 
                        key={ws.id} 
                        onClick={() => {
                          setActiveWs(ws.id.toString());
                          localStorage.setItem('omnibase_last_tenant', ws.id.toString());
                        }}
                        className="w-full flex items-center gap-3.5 p-4 bg-white/4 border border-white/8 rounded-xl cursor-pointer text-left transition-all hover:bg-brand-accent/8 hover:border-brand-accent/30 hover:translate-x-1 group"
                      >
                        <div className="w-[42px] h-[42px] rounded-lg flex items-center justify-center text-sm font-extrabold text-white shrink-0" style={{ background: accentColors[i % accentColors.length] }}>
                          {getInitials(ws.name)}
                        </div>
                        <div className="flex-1 flex flex-col gap-1 min-w-0">
                          <span className="text-[14.5px] font-bold text-text-primary truncate">{ws.name}</span>
                          <div className="flex items-center gap-1.5 text-xs text-text-muted">
                            <div className="w-4 h-4 rounded bg-gradient-to-br from-brand-accent to-[#a259ff] text-white text-[9px] font-extrabold flex items-center justify-center">
                              {userProfile?.name ? userProfile.name[0].toUpperCase() : 'H'}
                            </div>
                            <span>1 member</span>
                          </div>
                        </div>
                        <svg className="text-text-muted shrink-0 transition-all group-hover:text-brand-accent-2 group-hover:translate-x-1" width="18" height="18" viewBox="0 0 18 18" fill="none">
                          <path d="M4 9h10M9 4l5 5-5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        ) : (
          
          /* State 2: High-Fidelity 3-Step Wizard Panel perfectly matching screenshots */
          <div className="w-full max-w-[920px] bg-[#1a1b1e] rounded-2xl border border-white/10 shadow-[0_32px_80px_rgba(0,0,0,0.6)] overflow-hidden flex flex-col md:flex-row animate-fade-in-up min-h-[460px]">
            
            {/* Wizard Left Side Content */}
            <div className="flex-1 p-8 sm:p-12 flex flex-col justify-between relative z-10">
              
              <div>
                {/* Custom Progress Line Bars */}
                <div className="flex items-center gap-2 mb-8">
                  <div className={`h-1 w-8 rounded-full transition-colors duration-300 ${wizardStep >= 1 ? 'bg-white shadow-[0_0_8px_rgba(255,255,255,0.5)]' : 'bg-[#452768]'}`} />
                  <div className={`h-1 w-8 rounded-full transition-colors duration-300 ${wizardStep >= 2 ? 'bg-white shadow-[0_0_8px_rgba(255,255,255,0.5)]' : 'bg-[#452768]'}`} />
                  <div className={`h-1 w-8 rounded-full transition-colors duration-300 ${wizardStep >= 3 ? 'bg-white shadow-[0_0_8px_rgba(255,255,255,0.5)]' : 'bg-[#452768]'}`} />
                </div>

                {/* Step 1 View */}
                {wizardStep === 1 && (
                  <div className="animate-fade-in text-left">
                    <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-white mb-2">Name your Slack workspace</h2>
                    <p className="text-xs sm:text-sm text-text-secondary leading-relaxed mb-6">
                      Choose something your team will recognize like the name of your company or team. You can always update it later.
                    </p>

                    <div className="relative max-w-md">
                      <input
                        type="text"
                        className="w-full bg-[#131417] text-white placeholder-text-muted text-sm rounded-lg border-2 border-[#0ea5e9] focus:outline-none focus:shadow-[0_0_15px_rgba(14,165,233,0.25)] px-4 py-3 pr-12 transition-all font-medium"
                        placeholder="ex. Acme Inc."
                        value={workspaceName}
                        onChange={(e) => setWorkspaceName(e.target.value.slice(0, 50))}
                        onKeyDown={(e) => e.key === 'Enter' && setWizardStep(2)}
                        autoFocus
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-text-muted select-none font-mono">
                        {50 - workspaceName.length}
                      </span>
                    </div>

                    <button
                      onClick={() => setWizardStep(2)}
                      className={`mt-8 px-8 py-2.5 rounded-lg text-sm font-semibold transition-all cursor-pointer inline-flex items-center justify-center ${
                        workspaceName.trim()
                          ? 'bg-[#6b21a8] hover:bg-[#7e22ce] text-white shadow-lg shadow-purple-900/40 hover:-translate-y-0.5'
                          : 'bg-[#333538] text-white/70 hover:bg-[#3d3f44]'
                      }`}
                    >
                      Next
                    </button>
                  </div>
                )}

                {/* Step 2 View */}
                {wizardStep === 2 && (
                  <div className="animate-fade-in text-left">
                    <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-white mb-2">What’s your name?</h2>
                    <p className="text-xs sm:text-sm text-text-secondary leading-relaxed mb-6">
                      Adding your name and profile photo helps recognize and connect with you more easily.
                    </p>

                    <div className="relative max-w-md mb-6">
                      <input
                        type="text"
                        className="w-full bg-[#131417] text-white placeholder-text-muted text-sm rounded-lg border-2 border-[#0ea5e9] focus:outline-none focus:shadow-[0_0_15px_rgba(14,165,233,0.25)] px-4 py-3 pr-12 transition-all font-medium"
                        placeholder="Alex Rivera"
                        value={userName}
                        onChange={(e) => setUserName(e.target.value.slice(0, 38))}
                        onKeyDown={(e) => e.key === 'Enter' && setWizardStep(3)}
                        autoFocus
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-text-muted select-none font-mono">
                        {38 - userName.length}
                      </span>
                    </div>

                    <div className="flex flex-col gap-2.5 text-left">
                      <span className="text-xs font-bold text-white">Add a photo <span className="text-text-muted font-normal">(optional)</span></span>
                      <div className="relative w-14 h-14 rounded-xl bg-[#d81b60] flex items-center justify-center text-white font-extrabold text-2xl shadow-md">
                        {userName.trim() ? userName.trim()[0].toUpperCase() : 'H'}
                        <div className="absolute -bottom-1.5 -right-1.5 w-6 h-6 rounded-full bg-[#1e293b] border border-white/20 flex items-center justify-center cursor-pointer hover:bg-[#334155] transition-colors shadow-sm group">
                          <svg className="w-3 h-3 text-white group-hover:scale-110 transition-transform" viewBox="0 0 12 12" fill="none">
                            <path d="M8.5 1.5a1 1 0 111.4 1.4L3.5 9.5 1 10l.5-2.5 7-7z" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        </div>
                      </div>
                    </div>

                    <div className="flex gap-3 mt-8">
                      <button
                        onClick={() => setWizardStep(1)}
                        className="px-5 py-2.5 rounded-lg text-sm font-semibold bg-white/5 hover:bg-white/10 text-text-secondary hover:text-white transition-all cursor-pointer"
                      >
                        Back
                      </button>
                      <button
                        onClick={() => setWizardStep(3)}
                        className="px-8 py-2.5 rounded-lg text-sm font-semibold bg-[#6b21a8] hover:bg-[#7e22ce] text-white shadow-lg shadow-purple-900/40 hover:-translate-y-0.5 transition-all cursor-pointer"
                      >
                        Next
                      </button>
                    </div>
                  </div>
                )}

                {/* Step 3 View */}
                {wizardStep === 3 && (
                  <div className="animate-fade-in text-left">
                    <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-white mb-2">Invite your teammates</h2>
                    <p className="text-xs sm:text-sm text-text-secondary leading-relaxed mb-6">
                      Slack works better with more people. Add your core collaborators.
                    </p>
                    
                    <div className="max-w-md">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-bold text-white">Add teammate by email</span>
                        <button 
                          type="button"
                          onClick={() => setTeammateEmails('ellis@gmail.com, maria@gmail.com')}
                          className="flex items-center gap-1.5 text-xs text-[#0ea5e9] hover:underline cursor-pointer bg-transparent border-none p-0 font-medium"
                        >
                          <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24">
                            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
                            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
                          </svg>
                          Add from Google Contacts
                        </button>
                      </div>
                      
                      <textarea
                        rows="3"
                        className="w-full bg-[#131417] text-white placeholder-text-muted text-sm rounded-lg border-2 border-[#0ea5e9] focus:outline-none focus:shadow-[0_0_15px_rgba(14,165,233,0.25)] p-3.5 transition-all resize-none font-medium leading-relaxed"
                        placeholder="Ex. ellis@gmail.com, maria@gmail.com"
                        value={teammateEmails}
                        onChange={(e) => setTeammateEmails(e.target.value)}
                        autoFocus
                      />

                      <div className="flex items-center gap-3 mt-6 flex-wrap">
                        <button
                          onClick={handleFinishCreation}
                          disabled={creating}
                          className="px-6 py-2.5 rounded-lg text-sm font-semibold bg-[#6b21a8] hover:bg-[#7e22ce] text-white shadow-lg shadow-purple-900/40 hover:-translate-y-0.5 transition-all cursor-pointer flex items-center gap-2"
                        >
                          {creating ? (
                            <>
                              <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                              Completing...
                            </>
                          ) : 'Next'}
                        </button>
                        
                        <button
                          type="button"
                          onClick={() => {
                            navigator.clipboard.writeText(window.location.origin + '/invite?ws=' + encodeURIComponent(workspaceName.trim() || 'workspace'));
                            setCopied(true);
                            setTimeout(() => setCopied(false), 2000);
                          }}
                          className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium bg-transparent border border-white/10 hover:border-white/20 text-white transition-all cursor-pointer"
                        >
                          <svg className="w-4 h-4 text-text-muted shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                          </svg>
                          {copied ? 'Invite Link Copied!' : 'Copy Invite Link'}
                        </button>

                        <button
                          type="button"
                          onClick={handleFinishCreation}
                          className="ml-auto text-xs text-text-muted hover:text-white transition-colors cursor-pointer bg-transparent border-none p-0 font-medium tracking-wide"
                        >
                          Skip this step
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Wizard Footer Links / Cancel */}
              <div className="mt-8 pt-4 border-t border-white/5 flex items-center justify-between text-xs text-text-muted">
                <button 
                  onClick={() => { 
                    setShowCreateForm(false); 
                    setWizardStep(1); 
                    setWorkspaceName(''); 
                    setUserName(''); 
                    setTeammateEmails(''); 
                  }}
                  className="hover:text-white transition-colors cursor-pointer bg-transparent border-none p-0 flex items-center gap-1 font-medium"
                >
                  ← Cancel setup
                </button>
                <div className="flex items-center gap-3">
                  {wizardStep > 1 && (
                    <button 
                      onClick={() => setWizardStep(prev => prev - 1)}
                      className="hover:text-white transition-colors cursor-pointer bg-transparent border-none p-0 font-medium"
                    >
                      Previous step
                    </button>
                  )}
                  <span>Step {wizardStep} of 3</span>
                </div>
              </div>
            </div>

            {/* Live Interactive Slack UI Mockup Preview Side Pane perfectly matching screenshot right alignment */}
            <div className="w-full md:w-[380px] bg-[#131416] relative overflow-hidden flex items-end justify-end select-none border-t md:border-t-0 md:border-l border-white/5 shrink-0 pt-8 md:pt-16 pl-6">
              
              {/* Nested preview window cut off nicely at bottom right */}
              <div className="w-full h-[320px] md:h-[390px] bg-[#6b21a8] rounded-tl-xl overflow-hidden flex shadow-2xl relative border-t border-l border-white/10">
                
                {/* Thin App Switcher Column */}
                <div className="w-12 bg-[#4c1275] flex flex-col items-center py-3.5 gap-3.5 shrink-0 border-r border-white/5">
                  <div className="w-7 h-7 rounded-lg bg-amber-400 text-black font-black text-xs flex items-center justify-center shadow-sm">
                    {workspaceName.trim() ? workspaceName.trim()[0].toUpperCase() : 'A'}
                  </div>
                  <div className="flex flex-col gap-3.5 mt-2 w-full items-center text-white/40">
                    <span className="text-sm cursor-default">🏠</span>
                    <span className="text-sm cursor-default">📁</span>
                    <span className="text-sm cursor-default">🛠️</span>
                    <span className="text-xs tracking-widest text-white/20 mt-1">•••</span>
                  </div>
                </div>

                {/* Workspace Channel Sidebar Column */}
                <div className="w-[184px] bg-[#7e22ce] flex flex-col text-white/90 py-3.5 px-3 shrink-0 font-sans text-xs border-r border-white/5">
                  <div className="font-extrabold text-white text-[13px] mb-4 truncate px-1 drop-shadow-xs tracking-tight text-left">
                    {workspaceName.trim() || 'my-workspace'}
                  </div>
                  
                  <div className="flex flex-col gap-1 text-white/70 mb-4 px-1 text-left">
                    <div className="flex items-center gap-2 py-0.5 text-white/80">
                      <span className="text-[10px] opacity-60">≡</span> Unreads
                    </div>
                    <div className="flex items-center gap-2 py-0.5 text-white/80">
                      <span className="text-[10px] opacity-60">💬</span> Threads
                    </div>
                  </div>

                  <div className="flex flex-col gap-1 mb-4 text-left">
                    <div className="text-[9px] font-bold text-white/50 px-1 uppercase tracking-wider mb-1">
                      Channels
                    </div>
                    <div className="flex items-center gap-1.5 bg-white/10 text-white font-medium px-2 py-1 rounded">
                      <span className="text-white/50">#</span>{' '}
                      <span className="truncate">
                        all-{workspaceName.trim() ? workspaceName.trim().toLowerCase().replace(/\s+/g, '-') : 'workspace'}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 text-white/60 px-2 py-1 rounded">
                      <span className="text-white/40">+</span> Add channels
                    </div>
                  </div>

                  <div className="flex flex-col gap-1 text-left">
                    <div className="text-[9px] font-bold text-white/50 px-1 uppercase tracking-wider mb-1">
                      Direct messages
                    </div>
                    
                    {/* Active User DM Mock */}
                    <div className="flex items-center gap-1.5 px-1 py-1 rounded bg-white/5">
                      <div className="w-4 h-4 rounded bg-[#d81b60] flex items-center justify-center text-white font-bold text-[9px] shrink-0">
                        {userName.trim() ? userName.trim()[0].toUpperCase() : 'H'}
                      </div>
                      <span className="truncate max-w-[85px] text-white font-medium text-[11.5px]">
                        {userName.trim() || userEmail.split('@')[0] || 'Team Member'}
                      </span>
                      <span className="text-[8.5px] bg-white/15 text-white/70 px-1 rounded shrink-0 font-medium tracking-tighter ml-auto">you</span>
                    </div>

                    {/* Teammate DM Mock shown when emails are entered */}
                    {teammateEmails.trim() ? (
                      teammateEmails.split(',').map((email, idx) => {
                        const trimmed = email.trim();
                        if (!trimmed) return null;
                        return (
                          <div key={idx} className="flex items-center gap-1.5 px-1 py-1 rounded text-white/70 mt-0.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
                            <span className="truncate text-[11.5px]">
                              {trimmed.split('@')[0]}
                            </span>
                          </div>
                        );
                      })
                    ) : null}

                    <div className="flex items-center gap-1.5 text-white/40 px-1 py-1 mt-1 text-[11px]">
                      <span>+</span> Add teammates
                    </div>
                  </div>
                </div>

                {/* Main Chat Area Column Mock */}
                <div className="flex-1 bg-white text-black flex flex-col justify-between overflow-hidden relative text-left">
                  <div className="p-2.5 border-b border-black/5 flex items-center justify-between bg-gray-50">
                    <span className="text-[11px] font-extrabold text-gray-800 tracking-tight truncate max-w-[120px]">
                      # all-{workspaceName.trim() ? workspaceName.trim().toLowerCase().replace(/\s+/g, '-') : 'workspace'}
                    </span>
                    <span className="text-[9px] text-gray-400 font-medium shrink-0">Message #all</span>
                  </div>
                  
                  <div className="flex-1 p-3 flex flex-col justify-end gap-2.5 bg-white">
                    <div className="flex items-start gap-2">
                      <div className="w-5 h-5 rounded bg-[#d81b60] flex items-center justify-center text-white font-bold text-[10px] shrink-0 mt-0.5">
                        {userName.trim() ? userName.trim()[0].toUpperCase() : 'H'}
                      </div>
                      <div className="flex flex-col min-w-0">
                        <span className="text-[10px] font-extrabold text-gray-800 leading-tight truncate">
                          {userName.trim() || userEmail.split('@')[0] || 'Team Member'}
                        </span>
                        <span className="text-[11px] text-gray-600 leading-snug mt-0.5">
                          Setting up the workspace flow! ✨
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="p-2 border-t border-black/5 bg-gray-50/80">
                    <div className="bg-white border border-gray-200 rounded px-2 py-1 text-[9px] text-gray-400 truncate">
                      Message #all-{workspaceName.trim() ? workspaceName.trim().toLowerCase().replace(/\s+/g, '-') : 'workspace'}
                    </div>
                  </div>
                </div>

                {/* Vertical scrollbar edge indicator matching exactly the right side border highlight in images */}
                <div className="absolute right-1 top-2 bottom-2 w-1.5 bg-white/40 rounded-full z-20 shadow-xs pointer-events-none" />
              </div>
            </div>

          </div>
        )}
      </main>

      {/* Footer Bar */}
      <footer className="py-6 flex gap-6 mt-auto relative z-10 text-xs text-text-muted">
        <a href="#" className="hover:text-text-secondary transition-colors">Privacy & Terms</a>
        <a href="#" className="hover:text-text-secondary transition-colors">Contact Us</a>
        <a href="#" className="hover:text-text-secondary transition-colors">Status</a>
      </footer>
    </div>
  )
}

export default Workspace
