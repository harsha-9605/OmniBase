import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useGoogleLogin } from '@react-oauth/google'
import api from './api'

// Components
import Sidebar from './components/sidebar/Sidebar'
import Header from './components/layout/Header'
import ChatArea from './components/chat/ChatArea'
import { ChannelCreationWizard, PrivateChannelMembersModal } from './components/modals/ChannelModals'

function Home({ userProfile }) {
  const { tenantId, projectId, accountId } = useParams()
  const navigate = useNavigate()

  // ── Workspace name ────────────────────────────────────────────
  const [wsName, setWsName] = useState(() =>
    localStorage.getItem(`omnibase_last_tenant_name_${tenantId}`) || 'Workspace'
  )
  useEffect(() => {
    if (!tenantId) return
    api.get('/tenants/')
      .then(res => {
        const ws = res.data.find(w => w.id.toString() === tenantId.toString())
        if (ws) {
          setWsName(ws.name)
          localStorage.setItem(`omnibase_last_tenant_name_${tenantId}`, ws.name)
        }
      })
      .catch(err => console.error('Failed to fetch tenant name', err))
  }, [tenantId])

  const wsInitials = wsName.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
  const ownerName = userProfile?.name || 'Team Member'
  const dynamicAllChannelName = 'all-' + wsName.toLowerCase().replace(/\s+/g, '-')

  // ── Channels & UI state ───────────────────────────────────────
  const [channels, setChannels] = useState([])
  const [favourites, setFavourites] = useState([])
  const [invitedList, setInvitedList] = useState([])
  const [showChannelWizard, setShowChannelWizard] = useState(false)
  const [showMembersModal, setShowMembersModal] = useState(false)
  const [showInviteModal, setShowInviteModal] = useState(false)
  const [showChannelDetails, setShowChannelDetails] = useState(false)
  const [showRightSidebar, setShowRightSidebar] = useState(false)
  const [selectedProfile, setSelectedProfile] = useState(null)
  const [inviteEmailInput, setInviteEmailInput] = useState('')
  const [inviteSuccess, setInviteSuccess] = useState(false)
  const [channelNamesInitialised, setChannelNamesInitialised] = useState(false)

  // ── Notifications & Unread ────────────────────────────────────
  const [unreadStates, setUnreadStates] = useState({})
  const [notifications, setNotifications] = useState([])
  const [showNotifications, setShowNotifications] = useState(false)

  // ── Chat state ────────────────────────────────────────────────
  const [channelMessages, setChannelMessages] = useState([])
  const [newMessageText, setNewMessageText] = useState('')
  const [activeChannel, setActiveChannel] = useState('')
  const [activeProjectId, setActiveProjectId] = useState(null)
  const wsRef = useRef(null)

  // ── Initial data fetch ────────────────────────────────────────
  useEffect(() => {
    if (!tenantId) return
    const fetch = async () => {
      try {
        await api.post(`/api/tenants/${tenantId}/select`)
        const [channelsRes, usersRes, unreadRes, notifRes] = await Promise.all([
          api.get('/projects/'),
          api.get('/users/'),
          api.get('/projects/unread-states'),
          api.get('/notifications')
        ])
        if (channelsRes.data?.length > 0) {
          const publicChannels = channelsRes.data.filter(p => !p.is_private)
          if (publicChannels.length > 0) {
            setChannels(publicChannels.map(p => ({ id: p.id.toString(), name: p.name })))
          }
        }
        if (usersRes.data) {
          setInvitedList(usersRes.data.filter(u => u.account_id !== userProfile?.id))
        }
        if (unreadRes?.data) setUnreadStates(unreadRes.data)
        if (notifRes?.data) setNotifications(notifRes.data)
      } catch (err) {
        console.error('Failed to fetch dashboard data', err)
      }
    }
    fetch()
  }, [tenantId, userProfile?.id])

  // ── Poll unread + notifications every 60s ─────────────────────
  useEffect(() => {
    if (!tenantId) return
    const interval = setInterval(() => {
      api.get('/projects/unread-states').then(res => setUnreadStates(res.data)).catch(console.error)
      api.get('/notifications').then(res => setNotifications(res.data)).catch(console.error)
    }, 60000)
    return () => clearInterval(interval)
  }, [tenantId])

  // ── Sync channel name when wsName resolves ────────────────────
  useEffect(() => {
    if (wsName === 'Workspace' || channelNamesInitialised) return
    const allName = 'all-' + wsName.toLowerCase().replace(/\s+/g, '-')
    setChannels(prev => prev.map(c => c.id === 'all' ? { ...c, name: allName } : c))
    setActiveChannel(prev => prev === '# all-workspace' ? '# ' + allName : prev)
    setChannelNamesInitialised(true)
  }, [wsName, channelNamesInitialised])

  // ── Cleanup WS on unmount ─────────────────────────────────────
  useEffect(() => {
    return () => {
      if (wsRef.current) {
        wsRef.current.onclose = null
        wsRef.current.close()
      }
    }
  }, [])

  const formatMsg = (m) => ({
    id: m.id,
    sender: m.sender_name || m.sender,
    initials: (m.sender_name || m.sender) ? (m.sender_name || m.sender)[0].toUpperCase() : '?',
    time: new Date(m.created_at || m.time).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
    text: m.content || m.text,
    file_url: m.file_url,
    file_type: m.file_type,
    account_id: m.account_id,
    is_pinned: m.is_pinned,
    is_edited: m.is_edited,
    reactions: m.reactions || [],
    parent_id: m.parent_id,
    created_at: m.created_at || m.time
  })

  // ── Switch channel ────────────────────────────────────────────
  const switchChannel = useCallback(async (pid, channelName) => {
    if (wsRef.current) {
      wsRef.current.onclose = null
      wsRef.current.close()
      wsRef.current = null
    }
    setActiveChannel('# ' + channelName)
    setActiveProjectId(pid)
    setChannelMessages([])
    api.post(`/projects/${pid}/read`).then(() => {
      setUnreadStates(prev => ({ ...prev, [pid]: 0 }))
    }).catch(console.error)
    try {
      const res = await api.get(`/projects/${pid}/messages`)
      setChannelMessages(res.data.map(formatMsg))
    } catch (err) {
      console.error('Failed to load history', err)
    }
    const token = localStorage.getItem('omnibase_token')
    if (!token) return
    const ws = new WebSocket(`ws://localhost:8000/ws/${pid}?token=${token}`)
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data)
      if (msg.type === "MESSAGE_EDITED") {
        setChannelMessages(prev => prev.map(m => m.id === msg.message_id ? { ...m, text: msg.content, is_edited: true } : m))
      } else if (msg.type === "MESSAGE_PINNED") {
        setChannelMessages(prev => prev.map(m => m.id === msg.message_id ? { ...m, is_pinned: msg.is_pinned } : m))
      } else if (msg.type === "MESSAGE_DELETED") {
        setChannelMessages(prev => prev.filter(m => m.id !== msg.message_id))
      } else if (msg.type === "REACTION_UPDATED") {
        setChannelMessages(prev => prev.map(m => m.id === msg.message_id ? { ...m, reactions: msg.reactions } : m))
      } else if (msg.type === "NEW_MESSAGE" && msg.message) {
        if (!msg.message.is_reaction_bump) {
          setChannelMessages(prev => [...prev, formatMsg(msg.message)])
        }
      } else if (!msg.type) {
        setChannelMessages(prev => [...prev, formatMsg(msg)])
      }
      api.post(`/projects/${pid}/read`).catch(console.error)
    }
    ws.onerror = (err) => console.error('WS error', err)
    ws.onclose = () => { if (wsRef.current === ws) wsRef.current = null }
    wsRef.current = ws
  }, [])

  // ── Switch DM ─────────────────────────────────────────────────
  const switchDM = useCallback(async (targetAccountId, displayLabel) => {
    try {
      const res = await api.post('/projects/dm', { target_account_id: targetAccountId })
      const project = res.data
      if (wsRef.current) {
        wsRef.current.onclose = null
        wsRef.current.close()
        wsRef.current = null
      }
      setActiveChannel('DM: ' + displayLabel)
      setActiveProjectId(project.id)
      setChannelMessages([])
      api.post(`/projects/${project.id}/read`).then(() => {
        setUnreadStates(prev => ({ ...prev, [project.id]: 0 }))
      }).catch(console.error)
      try {
        const histRes = await api.get(`/projects/${project.id}/messages`)
        setChannelMessages(histRes.data.map(formatMsg))
      } catch (err) {
        console.error('Failed to load DM history', err)
      }
      const token = localStorage.getItem('omnibase_token')
      if (!token) return
      const ws = new WebSocket(`ws://localhost:8000/ws/${project.id}?token=${token}`)
      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data)
        if (msg.type === "MESSAGE_EDITED") {
          setChannelMessages(prev => prev.map(m => m.id === msg.message_id ? { ...m, text: msg.content, is_edited: true } : m))
        } else if (msg.type === "MESSAGE_PINNED") {
          setChannelMessages(prev => prev.map(m => m.id === msg.message_id ? { ...m, is_pinned: msg.is_pinned } : m))
        } else if (msg.type === "MESSAGE_DELETED") {
          setChannelMessages(prev => prev.filter(m => m.id !== msg.message_id))
        } else if (msg.type === "REACTION_UPDATED") {
          setChannelMessages(prev => prev.map(m => m.id === msg.message_id ? { ...m, reactions: msg.reactions } : m))
        } else if (msg.type === "NEW_MESSAGE" && msg.message) {
          if (!msg.message.is_reaction_bump) {
            setChannelMessages(prev => [...prev, formatMsg(msg.message)])
          }
        } else if (!msg.type) {
          setChannelMessages(prev => [...prev, formatMsg(msg)])
        }
        api.post(`/projects/${project.id}/read`).catch(console.error)
      }
      ws.onerror = (err) => console.error('DM WS error', err)
      ws.onclose = () => { if (wsRef.current === ws) wsRef.current = null }
      wsRef.current = ws
    } catch (err) {
      console.error('Failed to open DM', err)
    }
  }, [])

  // ── URL sync ──────────────────────────────────────────────────
  useEffect(() => {
    if (!channels.length) return
    if (projectId) {
      if (activeProjectId === projectId) return
      const c = channels.find(x => x.id.toString() === projectId.toString()) ||
                favourites.find(x => x.id.toString() === projectId.toString())
      if (c) switchChannel(c.id, c.name)
    } else if (accountId) {
      const u = invitedList.find(x => x.account_id.toString() === accountId.toString()) ||
                (userProfile?.id.toString() === accountId.toString() ? { name: ownerName + ' (you)' } : null)
      if (u) switchDM(accountId, u.name)
    } else {
      const allCh = channels.find(c => c.id === 'all' || c.name.startsWith('all-') || c.name === 'general') || channels[0]
      if (allCh && wsName !== 'Workspace') {
        navigate(`/workspace/${tenantId}/c/${allCh.id}`, { replace: true })
      }
    }
  }, [projectId, accountId, channels, invitedList, wsName, tenantId, navigate, activeProjectId, userProfile])

  // ── Send message ──────────────────────────────────────────────
  const handleSendMessage = (content = '', fileUrl = null, fileType = null, parentId = null) => {
    let text = typeof content === 'string' && content !== '' ? content.trim() : newMessageText.trim()
    if (text === '<p></p>') text = ''
    
    if (!text && !fileUrl) return
    
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      alert("Failed to send: You are not connected to the chat server.")
      return
    }
    
    wsRef.current.send(JSON.stringify({ 
      content: text,
      file_url: fileUrl,
      file_type: fileType,
      parent_id: parentId
    }))
    
    setNewMessageText('')
  }

  // ── Google contacts ───────────────────────────────────────────
  const handleGoogleContacts = useGoogleLogin({
    scope: 'https://www.googleapis.com/auth/contacts.readonly',
    onSuccess: async (tokenResponse) => {
      try {
        const res = await api.post('/api/auth/google-contacts', { access_token: tokenResponse.access_token })
        if (res.data.contacts?.length > 0) {
          const emails = res.data.contacts.map(c => c.email).join(', ')
          setInviteEmailInput(prev => prev ? prev + ', ' + emails : emails)
        }
      } catch (err) {
        console.error('Failed to fetch google contacts', err)
      }
    },
  })

  const handleSendInvites = async () => {
    if (!inviteEmailInput.trim()) return
    const newEmails = inviteEmailInput.split(',').map(e => e.trim()).filter(Boolean)
    try {
      await api.post('/api/invite', { emails: newEmails, workspace_name: wsName })
      setInvitedList(prev => [...prev, ...newEmails])
      setInviteSuccess(true)
      setTimeout(() => {
        setShowInviteModal(false)
        setInviteSuccess(false)
        setInviteEmailInput('')
      }, 1500)
    } catch (err) {
      console.error('Failed to send invites', err)
      alert('Failed to send invites: ' + (err.response?.data?.detail || err.message))
    }
  }

  // ── Render ────────────────────────────────────────────────────
  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#131619] text-[#f0f0ff] font-sans select-none text-left">

      {/* ── Left Sidebar ── */}
      <Sidebar
        wsName={wsName}
        wsInitials={wsInitials}
        ownerName={ownerName}
        userProfile={userProfile}
        channels={channels}
        setChannels={setChannels}
        favourites={favourites}
        setFavourites={setFavourites}
        invitedList={invitedList}
        activeChannel={activeChannel}
        setActiveChannel={setActiveChannel}
        setSelectedProfile={setSelectedProfile}
        setShowRightSidebar={setShowRightSidebar}
        setShowInviteModal={setShowInviteModal}
        setShowChannelWizard={setShowChannelWizard}
        switchDM={switchDM}
        unreadStates={unreadStates}
        notifications={notifications}
        setNotifications={setNotifications}
      />

      {/* ── Main content ── */}
      <div className="flex-1 flex flex-col min-w-0 bg-[#131619] relative">

        {/* Top header bar */}
        <Header
          wsName={wsName}
          invitedList={invitedList}
          notifications={notifications}
          setNotifications={setNotifications}
          showNotifications={showNotifications}
          setShowNotifications={setShowNotifications}
          setShowChannelDetails={setShowChannelDetails}
          channels={channels}
          switchChannel={switchChannel}
        />

        {/* Chat area */}
        <ChatArea
          activeChannel={activeChannel}
          activeProjectId={activeProjectId}
          dynamicAllChannelName={dynamicAllChannelName}
          ownerName={ownerName}
          channelMessages={channelMessages}
          newMessageText={newMessageText}
          setNewMessageText={setNewMessageText}
          handleSendMessage={handleSendMessage}
          channels={channels}
          favourites={favourites}
          setShowMembersModal={setShowMembersModal}
          invitedList={invitedList}
          userProfile={userProfile}
          tenantId={tenantId}
          setShowInviteModal={setShowInviteModal}
        />

        {/* ── Invite people modal ── */}
        {showInviteModal && (
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm z-[250] flex items-center justify-center p-4 animate-fade-in">
            <div className="bg-[#1b1f24] border border-white/10 rounded-xl w-full max-w-xl p-6 text-left shadow-2xl relative">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-[22px] font-bold text-white tracking-tight">Invite people to {wsName}</h2>
                <button
                  onClick={() => { setShowInviteModal(false); setInviteSuccess(false); setInviteEmailInput('') }}
                  className="text-white/60 hover:text-white transition-colors cursor-pointer w-8 h-8 flex items-center justify-center rounded-md hover:bg-white/5"
                >
                  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                </button>
              </div>
              {inviteSuccess ? (
                <div className="p-4 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 rounded-lg text-sm font-medium mb-4 flex items-center gap-2">
                  <span>✓</span> Invitations sent successfully!
                </div>
              ) : (
                <div className="flex flex-col gap-5">
                  <div className="flex flex-col gap-2">
                    <label className="text-[15px] font-bold text-white">To:</label>
                    <textarea rows="3" value={inviteEmailInput} onChange={(e) => setInviteEmailInput(e.target.value)} placeholder="name@gmail.com" className="w-full bg-transparent border border-white/20 rounded-lg p-3 text-[15px] text-white placeholder-white/40 focus:outline-none focus:border-white/40 resize-none transition-colors" />
                  </div>
                  <div className="flex items-center gap-4 py-1">
                    <div className="flex-1 h-[1px] bg-white/10"></div>
                    <span className="text-[13px] text-white/50 font-medium tracking-wide">OR</span>
                    <div className="flex-1 h-[1px] bg-white/10"></div>
                  </div>
                  <button onClick={() => handleGoogleContacts()} className="w-full flex items-center justify-center gap-3 py-3 bg-transparent border border-white/20 hover:bg-white/5 rounded-lg text-white font-bold transition-colors cursor-pointer text-[15px]">
                    <svg className="w-5 h-5" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                    </svg>
                    Continue with Google Workspace
                  </button>
                  <div className="flex flex-col gap-2">
                    <label className="text-[15px] font-bold text-white">Invite as:</label>
                    <div className="relative">
                      <select className="w-full bg-transparent border border-white/20 rounded-lg p-3 text-[15px] text-white appearance-none cursor-pointer focus:outline-none focus:border-white/40 font-medium">
                        <option value="member" className="bg-[#1b1f24] text-white">Member</option>
                        <option value="guest" className="bg-[#1b1f24] text-white">Guest</option>
                        <option value="admin" className="bg-[#1b1f24] text-white">Admin</option>
                      </select>
                      <div className="absolute inset-y-0 right-4 flex items-center pointer-events-none">
                        <svg className="w-4 h-4 text-white/70" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 9l6 6 6-6"/></svg>
                      </div>
                    </div>
                  </div>
                </div>
              )}
              <div className="flex items-center justify-between mt-8">
                <div className="flex items-center gap-1.5 text-[14px]">
                  <svg className="w-4 h-4 text-[#3b82f6]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>
                  <button onClick={() => { navigator.clipboard.writeText(window.location.origin + '/invite?ws=' + encodeURIComponent(wsName)) }} className="text-[#3b82f6] hover:underline font-medium cursor-pointer">Copy invite link</button>
                  <span className="text-white/40 mx-1.5">–</span>
                  <button className="text-white/40 hover:text-white transition-colors cursor-pointer font-medium">Edit link settings</button>
                </div>
                {!inviteSuccess && (
                  <button onClick={handleSendInvites} disabled={!inviteEmailInput.trim()} className={`px-6 py-2 rounded-md text-[14px] font-bold transition-all cursor-pointer ${inviteEmailInput.trim() ? 'bg-[#0d9488] hover:bg-[#0f766e] text-white shadow-sm' : 'bg-[#2a2d32] text-white/40 cursor-not-allowed'}`}>
                    Send
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── Channel details modal ── */}
        {showChannelDetails && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[200] flex items-center justify-center p-4 animate-fade-in">
            <div className="bg-[#1a1d21] border border-white/10 rounded-xl w-full max-w-[600px] shadow-2xl overflow-hidden flex flex-col h-[75vh]">
              <div className="p-6 pb-0 flex flex-col gap-4 bg-[#1a1d21] shrink-0">
                <div className="flex items-center justify-between">
                  <h2 className="text-xl font-extrabold text-white tracking-tight">{activeChannel.startsWith('#') ? activeChannel : `# ${activeChannel}`}</h2>
                  <button onClick={() => setShowChannelDetails(false)} className="text-white/40 hover:text-white transition-colors cursor-pointer w-8 h-8 flex items-center justify-center rounded-md hover:bg-white/5">
                    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <button className="flex items-center gap-1.5 px-3 py-1.5 bg-[#222529] hover:bg-[#2a2d32] border border-white/10 rounded-md text-white font-medium text-[13px] transition-colors cursor-pointer">
                    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>
                    <svg className="w-3 h-3 text-white/50" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M6 9l6 6 6-6" /></svg>
                  </button>
                  <button className="flex items-center gap-1.5 px-3 py-1.5 bg-[#222529] hover:bg-[#2a2d32] border border-white/10 rounded-md text-white font-medium text-[13px] transition-colors cursor-pointer">
                    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.73 21a2 2 0 0 1-3.46 0"></path></svg>
                    All new posts
                    <svg className="w-3 h-3 text-white/50" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M6 9l6 6 6-6" /></svg>
                  </button>
                </div>
                <div className="flex items-center gap-6 border-b border-white/10 mt-2">
                  <button className="pb-3 text-[14px] text-white/60 hover:text-white font-medium transition-colors cursor-pointer">About</button>
                  <button className="pb-3 text-[14px] text-white font-bold border-b-2 border-white cursor-pointer flex items-center gap-1.5">Members <span className="font-normal text-[13px] opacity-70">{1 + invitedList.length}</span></button>
                  <button className="pb-3 text-[14px] text-white/60 hover:text-white font-medium transition-colors cursor-pointer">Settings</button>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto p-6 bg-[#1a1d21]">
                <div className="flex gap-3 mb-6">
                  <div className="relative flex-1">
                    <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
                    <input type="text" placeholder="Find members" className="w-full bg-transparent border border-white/20 rounded-lg pl-9 pr-4 py-2 text-[14px] text-white placeholder-white/40 focus:outline-none focus:border-white/40 transition-colors" />
                  </div>
                </div>
                <div className="flex flex-col gap-1">
                  <button onClick={() => { setShowChannelDetails(false); setShowInviteModal(true) }} className="flex items-center gap-3 p-2 rounded-lg hover:bg-white/5 transition-colors cursor-pointer text-left w-full">
                    <div className="w-10 h-10 rounded-md bg-[#222529] flex items-center justify-center shrink-0 border border-white/10">
                      <svg className="w-5 h-5 text-[#0ea5e9]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="8.5" cy="7" r="4"></circle><line x1="20" y1="8" x2="20" y2="14"></line><line x1="23" y1="11" x2="17" y2="11"></line></svg>
                    </div>
                    <span className="font-bold text-[15px] text-white">Add people</span>
                  </button>
                  <div className="flex items-center justify-between p-2 rounded-lg hover:bg-white/5 transition-colors cursor-pointer mt-2">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-md bg-[#d81b60] text-white font-bold text-lg flex items-center justify-center shrink-0 relative">
                        {ownerName ? ownerName[0].toUpperCase() : 'H'}
                        <div className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-[#1a1d21] flex items-center justify-center">
                          <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 border-2 border-[#1a1d21]" />
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="font-bold text-[15px] text-white">{ownerName}</span>
                        <span className="text-[13px] text-white/50">(you)</span>
                      </div>
                    </div>
                    <span className="px-3 py-1 rounded-full border border-white/10 text-[12px] text-white/60 font-medium">Channel Manager</span>
                  </div>
                  {invitedList.map((userObj, i) => {
                    const name = userObj.name || userObj.email.split('@')[0]
                    return (
                      <div key={i} className="flex items-center justify-between p-2 rounded-lg hover:bg-white/5 transition-colors cursor-pointer mt-1">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-md bg-[#0ea5e9] text-white font-bold text-lg flex items-center justify-center shrink-0">
                            {name[0].toUpperCase()}
                          </div>
                          <span className="font-bold text-[15px] text-white">{name}</span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Right profile sidebar ── */}
      {showRightSidebar && selectedProfile && (
        <aside className="w-[320px] bg-[#0b0f12] border-l border-white/5 flex flex-col shrink-0 animate-fade-in text-left shadow-2xl z-20 relative">
          <div className="h-14 px-5 border-b border-white/5 flex items-center justify-between shrink-0">
            <h2 className="font-bold text-white tracking-tight">Profile</h2>
            <button onClick={() => setShowRightSidebar(false)} className="text-white/40 hover:text-white transition-colors cursor-pointer p-1 rounded hover:bg-white/5">✕</button>
          </div>
          <div className="p-6 flex flex-col items-center text-center">
            <div className="w-28 h-28 rounded-3xl bg-gradient-to-br from-indigo-500 to-purple-600 text-white font-extrabold text-5xl flex items-center justify-center mb-5 shadow-lg relative">
              {selectedProfile.initials}
              <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-emerald-500 border-4 border-[#0b0f12]" />
            </div>
            <h3 className="text-xl font-bold text-white tracking-tight">{selectedProfile.name}</h3>
            <p className="text-[13px] text-emerald-500 font-medium mt-1 mb-6">Online</p>
            <div className="w-full flex gap-2 justify-center">
              <button className="flex-1 bg-[#1e2329] hover:bg-[#2a3038] text-white py-2.5 rounded-xl text-sm font-semibold transition-colors shadow-sm cursor-pointer">Message</button>
              <button className="w-11 flex items-center justify-center bg-[#1e2329] hover:bg-[#2a3038] text-white rounded-xl transition-colors shadow-sm cursor-pointer">
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14m-7-7v14"/></svg>
              </button>
            </div>
          </div>
          <div className="px-6 py-5 border-t border-white/5 flex-1">
            <h4 className="text-[11px] font-bold text-white/40 uppercase mb-4 tracking-wider">Contact Information</h4>
            <div className="flex flex-col gap-4">
              <div className="bg-[#1e2329]/50 p-3 rounded-lg border border-white/5">
                <div className="flex items-center gap-2 text-white/50 mb-1">
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path><polyline points="22,6 12,13 2,6"></polyline></svg>
                  <div className="text-[11px] font-semibold">Email Address</div>
                </div>
                <div className="text-[13px] text-white/90 font-medium">{selectedProfile.email}</div>
              </div>
              <div className="bg-[#1e2329]/50 p-3 rounded-lg border border-white/5">
                <div className="flex items-center gap-2 text-white/50 mb-1">
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
                  <div className="text-[11px] font-semibold">Local Time</div>
                </div>
                <div className="text-[13px] text-white/90 font-medium">{new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</div>
              </div>
            </div>
          </div>
        </aside>
      )}

      {/* ── Floating modals ── */}
      {showChannelWizard && (
        <ChannelCreationWizard
          onClose={() => setShowChannelWizard(false)}
          onCreated={(newCh) => {
            setChannels(prev => [...prev, { id: newCh.id.toString(), name: newCh.name }])
          }}
        />
      )}
      {showMembersModal && activeProjectId && (
        <PrivateChannelMembersModal
          projectId={activeProjectId}
          onClose={() => setShowMembersModal(false)}
        />
      )}
    </div>
  )
}

export default Home
