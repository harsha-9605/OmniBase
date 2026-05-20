import re

file_path = "c:/projects/OmniBase/frontend/src/Home.jsx"

with open(file_path, "r", encoding="utf-8") as f:
    content = f.read()

# 1. Add state variables
state_vars = """  const [showRightSidebar, setShowRightSidebar] = useState(false)
  const [selectedProfile, setSelectedProfile] = useState(null)
  
  const [unreadStates, setUnreadStates] = useState({})
  const [notifications, setNotifications] = useState([])
  const [showNotifications, setShowNotifications] = useState(false)"""
content = content.replace(
    "  const [showRightSidebar, setShowRightSidebar] = useState(false)\n  const [selectedProfile, setSelectedProfile] = useState(null)",
    state_vars
)

# 2. Update fetchChannelsAndUsers
fetch_code = """        const [channelsRes, usersRes] = await Promise.all([
          api.get('/projects/'),
          api.get('/users/')
        ])"""
new_fetch_code = """        const [channelsRes, usersRes, unreadRes, notifRes] = await Promise.all([
          api.get('/projects/'),
          api.get('/users/'),
          api.get('/projects/unread-states'),
          api.get('/notifications')
        ])"""
content = content.replace(fetch_code, new_fetch_code)

set_users_code = """          const others = usersRes.data.filter(u => u.account_id !== userProfile?.id)
          setInvitedList(others)
        }"""
new_set_users_code = """          const others = usersRes.data.filter(u => u.account_id !== userProfile?.id)
          setInvitedList(others)
        }
        if (unreadRes && unreadRes.data) setUnreadStates(unreadRes.data)
        if (notifRes && notifRes.data) setNotifications(notifRes.data)"""
content = content.replace(set_users_code, new_set_users_code)

# 3. Add Polling
polling_code = """  // Direct Messages Invited List State"""
new_polling_code = """  // Poll for unread states and notifications
  useEffect(() => {
    if (!tenantId) return;
    const interval = setInterval(() => {
      api.get('/projects/unread-states').then(res => setUnreadStates(res.data)).catch(console.error)
      api.get('/notifications').then(res => setNotifications(res.data)).catch(console.error)
    }, 10000)
    return () => clearInterval(interval)
  }, [tenantId])

  // Direct Messages Invited List State"""
content = content.replace(polling_code, new_polling_code)

# 4. Read Receipts on switchChannel
switch_ch_code = """    setActiveChannel('# ' + channelName)
    setActiveProjectId(projectId)
    setChannelMessages([])"""
new_switch_ch_code = """    setActiveChannel('# ' + channelName)
    setActiveProjectId(projectId)
    setChannelMessages([])
    
    api.post(`/projects/${projectId}/read`).then(() => {
      setUnreadStates(prev => ({ ...prev, [projectId]: 0 }))
    }).catch(console.error)"""
content = content.replace(switch_ch_code, new_switch_ch_code)

# 5. Read Receipts on switchDM
switch_dm_code = """      setActiveChannel('DM: ' + displayLabel)
      setActiveProjectId(project.id)
      setChannelMessages([])"""
new_switch_dm_code = """      setActiveChannel('DM: ' + displayLabel)
      setActiveProjectId(project.id)
      setChannelMessages([])
      
      api.post(`/projects/${project.id}/read`).then(() => {
        setUnreadStates(prev => ({ ...prev, [project.id]: 0 }))
      }).catch(console.error)"""
content = content.replace(switch_dm_code, new_switch_dm_code)

# 6. Read Receipts on incoming WS message
ws_msg_code = """    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data)
      setChannelMessages(prev => [...prev, formatMsg(msg)])
    }"""
new_ws_msg_code = """    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data)
      setChannelMessages(prev => [...prev, formatMsg(msg)])
      api.post(`/projects/${projectId}/read`).catch(console.error)
    }"""
content = content.replace(ws_msg_code, new_ws_msg_code)

ws_dm_msg_code = """      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data)
        setChannelMessages(prev => [...prev, formatMsg(msg)])
      }"""
new_ws_dm_msg_code = """      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data)
        setChannelMessages(prev => [...prev, formatMsg(msg)])
        api.post(`/projects/${project.id}/read`).catch(console.error)
      }"""
content = content.replace(ws_dm_msg_code, new_ws_dm_msg_code)

# 7. Add Unread badges to Channels UI
ch_ui_code = """                    <span className="text-white/30 shrink-0 text-lg font-light leading-none mb-0.5">#</span>
                    <span className="truncate">{c.name}</span>
                  </button>"""
new_ch_ui_code = """                    <span className="text-white/30 shrink-0 text-lg font-light leading-none mb-0.5">#</span>
                    <span className={`truncate ${unreadStates[c.id] > 0 ? 'text-white font-bold' : ''}`}>{c.name}</span>
                    {unreadStates[c.id] > 0 && (
                      <span className="ml-2 bg-[#d81b60] text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center">
                        {unreadStates[c.id]}
                      </span>
                    )}
                  </button>"""
content = content.replace(ch_ui_code, new_ch_ui_code)

# 8. Add Unread badges to DM UI
dm_ui_code = """                  <div className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full bg-emerald-500 border border-[#0b0f12]" />
                </div>
                <span className="truncate">{displayName}</span>"""
new_dm_ui_code = """                  <div className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full bg-emerald-500 border border-[#0b0f12]" />
                </div>
                <span className={`truncate ${unreadStates[userObj.project_id] > 0 ? 'text-white font-bold' : ''}`}>{displayName}</span>
                {unreadStates[userObj.project_id] > 0 && (
                  <span className="ml-auto bg-[#d81b60] text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center">
                    {unreadStates[userObj.project_id]}
                  </span>
                )}"""
# Note: invitedList doesn't have project_id natively in this mockup without backend matching, 
# but we can try matching or simply showing the green dot. Since DM unread is based on project ID,
# we need to be careful. Actually, let's skip DM exact unread counts on the sidebar if project_id isn't known, 
# or just add the Notification Bell which is the main goal.

# 9. Add Notification Bell to Header
header_code = """          <div className="flex items-center gap-1.5 shrink-0 ml-4">
            {/* People Button */}"""
new_header_code = """          <div className="flex items-center gap-1.5 shrink-0 ml-4">
            {/* Notification Bell */}
            <div className="relative group">
              <button 
                onClick={() => setShowNotifications(!showNotifications)}
                className="relative flex items-center justify-center w-8 h-8 rounded-md hover:bg-white/10 text-white/80 transition-colors cursor-pointer"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
                  <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
                </svg>
                {notifications.filter(n => !n.is_read).length > 0 && (
                  <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-[#d81b60] rounded-full border border-[#131619]" />
                )}
              </button>
              
              {showNotifications && (
                <div className="absolute top-full right-0 mt-2 w-80 bg-[#1e2329] border border-white/10 rounded-xl shadow-2xl overflow-hidden z-50 animate-fade-in">
                  <div className="px-4 py-3 border-b border-white/5 flex justify-between items-center">
                    <span className="text-sm font-bold text-white">Notifications</span>
                    <span className="text-[10px] text-brand-accent-2 cursor-pointer hover:underline" onClick={() => {
                        notifications.filter(n => !n.is_read).forEach(n => api.post(`/notifications/${n.id}/read`))
                        setNotifications(prev => prev.map(n => ({...n, is_read: true})))
                    }}>Mark all as read</span>
                  </div>
                  <div className="max-h-[300px] overflow-y-auto">
                    {notifications.length === 0 ? (
                      <div className="px-4 py-6 text-center text-xs text-white/40">You're all caught up!</div>
                    ) : (
                      notifications.map(n => (
                        <div key={n.id} className={`px-4 py-3 border-b border-white/5 cursor-pointer hover:bg-white/5 transition-colors ${n.is_read ? 'opacity-60' : 'bg-brand-accent/5'}`} onClick={() => {
                          if (!n.is_read) {
                            api.post(`/notifications/${n.id}/read`)
                            setNotifications(prev => prev.map(x => x.id === n.id ? {...x, is_read: true} : x))
                          }
                          if (n.project_id) {
                            const c = channels.find(ch => ch.id == n.project_id)
                            if (c) switchChannel(c.id, c.name)
                            setShowNotifications(false)
                          }
                        }}>
                          <div className="flex gap-3">
                            <div className="w-8 h-8 rounded-full bg-brand-accent/20 text-brand-accent flex items-center justify-center shrink-0">
                              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                {n.type === 'mention' ? <path d="M12 20a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4z" /> : <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>}
                              </svg>
                            </div>
                            <div className="flex flex-col gap-1">
                              <span className="text-xs text-white leading-relaxed">{n.content_preview}</span>
                              <span className="text-[10px] text-white/40">{new Date(n.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* People Button */}"""
content = content.replace(header_code, new_header_code)

with open(file_path, "w", encoding="utf-8") as f:
    f.write(content)
print("Updated Home.jsx successfully")
