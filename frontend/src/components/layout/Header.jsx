import api from '../../api'

export default function Header({
  wsName,
  invitedList,
  notifications,
  setNotifications,
  showNotifications,
  setShowNotifications,
  setShowChannelDetails,
  channels,
  switchChannel,
}) {
  const unreadCount = notifications.filter(n => !n.is_read).length

  return (
    <header className="h-14 border-b border-white/5 px-6 flex items-center justify-between shrink-0 bg-[#131619]/90 backdrop-blur-md z-10">

      {/* Search bar */}
      <div className="flex-1 max-w-xl mx-auto">
        <div className="relative w-full">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8"></circle>
            <path d="M21 21l-4.35-4.35"></path>
          </svg>
          <input
            type="text"
            placeholder={`Search ${wsName}`}
            className="w-full bg-white/5 border border-white/8 rounded-lg pl-9 pr-4 py-1.5 text-xs text-white placeholder-white/30 focus:outline-none focus:border-white/20 focus:bg-white/8 transition-all font-medium"
          />
        </div>
      </div>

      {/* Right icons */}
      <div className="flex items-center gap-1.5 shrink-0 ml-4">

        {/* Notification Bell */}
        <div className="relative">
          <button
            onClick={() => setShowNotifications(!showNotifications)}
            className="relative flex items-center justify-center w-8 h-8 rounded-md hover:bg-white/10 text-white/80 transition-colors cursor-pointer"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
              <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
            </svg>
            {unreadCount > 0 && (
              <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-[#d81b60] rounded-full border border-[#131619]" />
            )}
          </button>

          {showNotifications && (
            <div className="absolute top-full right-0 mt-2 w-80 bg-[#1e2329] border border-white/10 rounded-xl shadow-2xl overflow-hidden z-50 animate-fade-in">
              <div className="px-4 py-3 border-b border-white/5 flex justify-between items-center">
                <span className="text-sm font-bold text-white">Notifications</span>
                <span
                  className="text-[10px] text-[#2dd4bf] cursor-pointer hover:underline"
                  onClick={() => {
                    notifications.filter(n => !n.is_read).forEach(n => api.post(`/notifications/${n.id}/read`))
                    setNotifications(prev => prev.map(n => ({ ...n, is_read: true })))
                  }}
                >Mark all as read</span>
              </div>
              <div className="max-h-[300px] overflow-y-auto">
                {notifications.length === 0 ? (
                  <div className="px-4 py-6 text-center text-xs text-white/40">You're all caught up!</div>
                ) : (
                  notifications.map(n => (
                    <div
                      key={n.id}
                      className={`px-4 py-3 border-b border-white/5 cursor-pointer hover:bg-white/5 transition-colors ${n.is_read ? 'opacity-60' : 'bg-[#0d9488]/5'}`}
                      onClick={() => {
                        if (!n.is_read) {
                          api.post(`/notifications/${n.id}/read`)
                          setNotifications(prev => prev.map(x => x.id === n.id ? { ...x, is_read: true } : x))
                        }
                        if (n.project_id) {
                          const c = channels.find(ch => ch.id == n.project_id)
                          if (c) switchChannel(c.id, c.name)
                          setShowNotifications(false)
                        }
                      }}
                    >
                      <div className="flex gap-3">
                        <div className="w-8 h-8 rounded-full bg-[#0d9488]/20 text-[#2dd4bf] flex items-center justify-center shrink-0">
                          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            {n.type === 'mention'
                              ? <path d="M12 20a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4z" />
                              : <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
                            }
                          </svg>
                        </div>
                        <div className="flex flex-col gap-1">
                          <span className="text-xs text-white leading-relaxed">{n.content_preview}</span>
                          <span className="text-[10px] text-white/40">{new Date(n.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        {/* People / Members Button */}
        <div className="relative group">
          <button
            onClick={() => setShowChannelDetails(true)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 border border-white/20 hover:bg-white/10 rounded-md text-white/80 transition-colors cursor-pointer"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
              <circle cx="9" cy="7" r="4"></circle>
              <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
              <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
            </svg>
            <span className="text-xs font-bold">{1 + invitedList.length}</span>
          </button>
          <div className="absolute top-full right-0 mt-2 w-56 bg-[#222529] border border-white/10 rounded-lg shadow-xl p-3 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50 text-center">
            <div className="absolute -top-1.5 right-4 w-3 h-3 bg-[#222529] border-t border-l border-white/10 rotate-45"></div>
            <div className="text-[13px] font-bold text-white mb-1 relative z-10">View all members of this channel</div>
            <div className="text-[12px] text-white/60 relative z-10">
              Includes {invitedList.length > 0 ? (invitedList[0].name || invitedList[0].email.split('@')[0]) : 'you'}
            </div>
          </div>
        </div>

        {/* Huddle */}
        <button className="flex items-center gap-1 px-2.5 py-1.5 border border-white/20 hover:bg-white/10 rounded-md text-white/80 transition-colors cursor-pointer">
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 18v-6a9 9 0 0 1 18 0v6"></path>
            <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"></path>
          </svg>
          <svg className="w-3 h-3 text-white/50" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>

        {/* More */}
        <button className="flex items-center justify-center w-8 h-8 border border-white/20 hover:bg-white/10 rounded-md text-white/80 transition-colors cursor-pointer">
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="1"></circle>
            <circle cx="12" cy="5" r="1"></circle>
            <circle cx="12" cy="19" r="1"></circle>
          </svg>
        </button>
      </div>
    </header>
  )
}
