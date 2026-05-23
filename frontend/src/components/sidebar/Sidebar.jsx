import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import api from '../../api'

export default function Sidebar({
  wsName,
  wsInitials,
  ownerName,
  userProfile,
  channels,
  setChannels,
  favourites,
  setFavourites,
  invitedList,
  activeChannel,
  setActiveChannel,
  setSelectedProfile,
  setShowRightSidebar,
  setShowInviteModal,
  setShowChannelWizard,
  switchDM,
  unreadStates,
  notifications,
  setNotifications,
}) {
  const navigate = useNavigate()
  const { tenantId } = useParams()
  const [showWsMenu, setShowWsMenu] = useState(false)
  const [draggedChannel, setDraggedChannel] = useState(null)
  const [isDragOverFav, setIsDragOverFav] = useState(false)
  const [onlyUnreads, setOnlyUnreads] = useState(false)

  const handleMarkAsRead = async (n) => {
    try {
      await api.post(`/notifications/${n.id}/read`)
      setNotifications(prev => prev.map(x => x.id === n.id ? { ...x, is_read: true } : x))
    } catch (err) {
      console.error("Failed to mark notification as read", err)
    }
  }

  const handleNotificationClick = async (n) => {
    if (!n.is_read) {
      await handleMarkAsRead(n)
    }
    if (n.project_id) {
      navigate(`/workspace/${tenantId}/c/${n.project_id}`)
    }
  }

  const getRelativeTime = (dateStr) => {
    if (!dateStr) return ''
    const date = new Date(dateStr)
    const now = new Date()
    const diffMs = now - date
    const diffMins = Math.floor(diffMs / 60000)
    
    if (diffMins < 1) return 'now'
    if (diffMins < 60) return `${diffMins} mins`
    
    const diffHours = Math.floor(diffMins / 60)
    if (diffHours < 24) return `${diffHours} hrs`
    
    const diffDays = Math.floor(diffHours / 24)
    return `${diffDays} days`
  }

  return (
    <aside className="w-[320px] bg-[#0b0f12] border-r border-white/5 flex flex-col justify-between shrink-0 text-sm">

      {/* ── Workspace Header ─────────────────────────────── */}
      <div className="h-14 px-4 border-b border-white/5 flex items-center justify-between relative">
        <button
          onClick={() => setShowWsMenu(!showWsMenu)}
          className="flex items-center gap-2.5 font-bold text-white hover:opacity-80 transition-opacity cursor-pointer text-left min-w-0"
        >
          <div className="w-7 h-7 rounded bg-[#0d9488] text-black font-extrabold text-xs flex items-center justify-center shrink-0 shadow-sm">
            {wsInitials}
          </div>
          <span className="truncate text-[15px] tracking-tight">{wsName}</span>
          <svg className="w-3.5 h-3.5 text-white/50 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>

        <button
          onClick={() => navigate('/workspaces?noRedirect=true')}
          title="Close Dashboard"
          className="text-white/40 hover:text-white transition-colors cursor-pointer p-1 rounded hover:bg-white/5 font-bold text-xs"
        >✕</button>

        {showWsMenu && (
          <div className="absolute top-full left-2 w-60 bg-[#1e2329] border border-white/10 rounded-xl shadow-2xl py-2 z-50 animate-fade-in">
            <div className="px-3 py-1.5 text-xs font-bold text-white/40 uppercase tracking-wider">Active Workspace</div>
            <div className="px-3 py-2 flex items-center gap-2.5 text-white bg-white/5">
              <div className="w-6 h-6 rounded bg-[#0d9488] text-black font-extrabold text-[11px] flex items-center justify-center">{wsInitials}</div>
              <span className="truncate font-medium text-sm">{wsName}</span>
            </div>
            <div className="my-1.5 border-t border-white/5" />
            <button
              onClick={() => { setShowWsMenu(false); navigate('/workspaces?noRedirect=true'); }}
              className="w-full px-3 py-2 text-left text-xs text-white/70 hover:text-white hover:bg-white/5 transition-colors flex items-center gap-2 cursor-pointer font-medium"
            >
              <svg className="w-4 h-4 text-white/50" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M10 19l-7-7m0 0l7-7m-7 7h18"></path>
              </svg>
              Exit to Workspace Selector
            </button>
          </div>
        )}
      </div>

      {/* ── Scrollable Content ───────────────────────────── */}
      <div className="flex-1 overflow-y-auto py-3 px-2 flex flex-col gap-4 text-[#c8c8d8]">

        {/* Main Nav Tabs */}
        <div className="flex flex-col gap-0.5">
          <button className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg bg-white/8 text-white font-medium cursor-pointer transition-colors text-left">
            <svg className="w-4 h-4 text-white shrink-0" viewBox="0 0 24 24" fill="currentColor">
              <path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/>
            </svg>
            <span>Home</span>
          </button>

          {/* DMs Hover Popover */}
          <div className="group">
            <button className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-white/4 text-white/70 hover:text-white font-medium cursor-pointer transition-colors text-left">
              <svg className="w-4 h-4 text-white/60 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
              </svg>
              <span>DMs</span>
            </button>
            <div className="fixed left-[320px] top-[106px] pl-3 w-[392px] opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-[100] translate-y-1 group-hover:translate-y-0">
              <div className="bg-[#1e2329] border border-white/10 rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[500px]">
                <div className="px-4 py-3 border-b border-white/5 flex items-center justify-between bg-[#1b1f24] shrink-0">
                  <h3 className="font-bold text-white text-[15px]">Direct messages</h3>
                  <div className="flex items-center gap-2 text-xs text-white/60 font-medium">
                    <span>Unreads</span>
                    <div className="w-8 h-4 bg-white/10 rounded-full relative cursor-pointer hover:bg-white/20 transition-colors">
                      <div className="w-3.5 h-3.5 bg-white/60 rounded-full absolute left-0.5 top-[1px]"></div>
                    </div>
                  </div>
                </div>
                <div className="p-2 flex flex-col gap-1 overflow-y-auto">
                  <div
                    onClick={() => {
                      setActiveChannel(ownerName + ' (you)')
                      setSelectedProfile({ name: ownerName, initials: ownerName ? ownerName[0].toUpperCase() : 'H', email: 'You' })
                      setShowRightSidebar(true)
                    }}
                    className="p-2 flex items-start gap-3 rounded-lg hover:bg-white/5 cursor-pointer transition-colors group"
                  >
                    <div className="w-9 h-9 rounded-md bg-[#d81b60] text-white font-bold text-sm flex items-center justify-center shrink-0 relative mt-0.5">
                      {ownerName ? ownerName[0].toUpperCase() : 'H'}
                      <div className="absolute -bottom-1 -right-1 w-3.5 h-3.5 rounded-full bg-[#1e2329] group-hover:bg-[#252a30] transition-colors flex items-center justify-center">
                        <div className="w-2.5 h-2.5 rounded-full bg-[#10b981]" />
                      </div>
                    </div>
                    <div className="flex flex-col flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="font-bold text-white text-[15px] truncate">{ownerName}</span>
                        <span className="text-[11px] text-white/50">(you)</span>
                      </div>
                      <p className="text-[13px] text-white/60 leading-snug mt-0.5 max-w-[280px]">This is your space. Draft messages, list your to-dos, or keep links and files handy.</p>
                    </div>
                  </div>
                  {invitedList.length > 0 && invitedList.map((userObj, i) => {
                    const name = userObj.name || userObj.email.split('@')[0]
                    const isOnline = userObj.is_online // Assume true/false
                    return (
                      <div
                        key={i}
                        onClick={() => {
                          switchDM(userObj.account_id, name)
                          setSelectedProfile({ name, initials: name[0].toUpperCase(), email: userObj.email })
                          setShowRightSidebar(true)
                        }}
                        className="p-2 flex items-start gap-3 rounded-lg hover:bg-white/5 cursor-pointer transition-colors border-t border-white/5 mt-1 pt-3 group"
                      >
                        <div className="w-9 h-9 rounded-md bg-indigo-500 text-white font-bold text-sm flex items-center justify-center shrink-0 relative mt-0.5">
                          {name[0].toUpperCase()}
                          <div className="absolute -bottom-1 -right-1 w-3.5 h-3.5 rounded-full bg-[#1e2329] group-hover:bg-[#252a30] transition-colors flex items-center justify-center">
                            {isOnline ? (
                               <div className="w-2.5 h-2.5 rounded-full bg-[#10b981]" />
                            ) : (
                               <div className="w-2 h-2 rounded-full border-[1.5px] border-white/50 bg-transparent" />
                            )}
                          </div>
                        </div>
                        <div className="flex flex-col flex-1 min-w-0 justify-center">
                          <span className="font-bold text-white text-[15px] truncate">{name}</span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          </div>

          {/* Activity Hover Popover */}
          <div className="group">
            <button className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-white/4 text-white/70 hover:text-white font-medium cursor-pointer transition-colors text-left">
              <svg className="w-4 h-4 text-white/60 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
                <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
              </svg>
              <span>Activity</span>
            </button>
            <div className="fixed left-[320px] top-[144px] pl-3 w-[392px] opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-[100] translate-y-1 group-hover:translate-y-0">
              <div className="bg-[#1e2329] border border-white/10 rounded-xl shadow-2xl overflow-hidden flex flex-col h-[350px]">
                <div className="px-4 pt-3 border-b border-white/5 flex items-center justify-between bg-[#1b1f24] shrink-0">
                  <div className="flex items-center gap-4 text-[15px] font-bold">
                    <span className="text-white cursor-pointer relative pb-2.5">Activity<div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#2dd4bf] rounded-t-full"></div></span>
                    <span className="text-white/50 hover:text-white cursor-pointer pb-2.5">All</span>
                    <span className="text-white/50 hover:text-white cursor-pointer pb-2.5">DMs</span>
                  </div>
                  <button 
                    onClick={() => setOnlyUnreads(!onlyUnreads)}
                    className="flex items-center gap-2 text-xs text-white/60 font-medium mb-2.5 cursor-pointer bg-transparent border-none outline-none"
                  >
                    <span>Unreads</span>
                    <div className={`w-8 h-4 rounded-full relative transition-colors ${onlyUnreads ? 'bg-[#2dd4bf]' : 'bg-white/10'}`}>
                      <div className={`w-3.5 h-3.5 bg-white rounded-full absolute top-[1px] transition-all duration-200 ${onlyUnreads ? 'translate-x-3.5' : 'translate-x-0'}`}></div>
                    </div>
                  </button>
                </div>
                
                <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-1.5 text-left">
                  {((notifications || []).filter(n => !onlyUnreads || !n.is_read)).length === 0 ? (
                    <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
                      <div className="w-14 h-14 bg-[#78b368] rounded-xl flex items-center justify-center mb-5 shadow-inner">
                        <span className="text-2xl text-white">✓</span>
                      </div>
                      <h3 className="text-[17px] font-bold text-white mb-2">All caught up</h3>
                      <p className="text-[15px] text-white/60 leading-relaxed max-w-[280px]">Looks like things are quiet for now. When there's new activity, it'll be here.</p>
                    </div>
                  ) : (
                    ((notifications || []).filter(n => !onlyUnreads || !n.is_read)).map(n => {
                      const channelName = channels.find(c => c.id.toString() === n.project_id?.toString())?.name || 'channel'
                      const isUnread = !n.is_read
                      
                      return (
                        <div
                          key={n.id}
                          onClick={() => handleNotificationClick(n)}
                          className={`p-3 rounded-lg flex items-start justify-between gap-3 cursor-pointer transition-all relative border border-white/5 ${
                            isUnread 
                              ? 'bg-white/[0.04] hover:bg-white/[0.08] text-white' 
                              : 'bg-black/15 hover:bg-white/2 text-white/40'
                          }`}
                        >
                          <div className="flex gap-3 min-w-0">
                            <div className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center shrink-0 border border-white/5">
                              <svg className={`w-4 h-4 ${isUnread ? 'text-white/85' : 'text-white/25'}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
                                <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
                              </svg>
                            </div>
                            
                            <div className="flex flex-col min-w-0 text-left">
                              <div className="flex items-center gap-1.5">
                                <span className={`text-[12.5px] ${isUnread ? 'font-bold text-white' : 'font-medium text-white/40'}`}>
                                  {n.type === 'mention' ? 'Mention' : 'Reminder'}
                                </span>
                                <span className="text-[11px] text-white/30 truncate">
                                  Post in #{channelName}
                                </span>
                              </div>
                              <p className={`text-[13px] mt-0.5 truncate max-w-[200px] leading-relaxed ${isUnread ? 'text-white/90 font-medium' : 'text-white/30'}`}>
                                {n.content_preview}
                              </p>
                            </div>
                          </div>

                          <div className="flex items-center gap-2 shrink-0 self-center">
                            <span className="text-[10px] text-white/30 font-medium">{getRelativeTime(n.created_at)}</span>
                            {isUnread ? (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleMarkAsRead(n);
                                }}
                                className="w-6 h-6 rounded bg-[#2dd4bf]/20 hover:bg-[#2dd4bf]/40 border border-[#2dd4bf]/30 flex items-center justify-center text-[#2dd4bf] hover:text-white transition-all cursor-pointer shadow-sm animate-pulse"
                                title="Mark as read"
                              >
                                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                                  <polyline points="20 6 9 17 4 12"></polyline>
                                </svg>
                              </button>
                            ) : (
                              <svg className="w-4 h-4 text-[#2dd4bf] ml-1" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                <polyline points="20 6 9 17 4 12"></polyline>
                              </svg>
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Directories */}
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between px-2 py-1 text-white/40 hover:text-white/70 cursor-pointer transition-colors text-xs font-semibold tracking-wide">
            <span className="flex items-center gap-1.5">
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 9l6 6 6-6"/></svg>
              Directories
            </span>
          </div>
        </div>

        {/* Favourites (drag-and-drop) */}
        <div
          className={`flex flex-col gap-1 rounded-lg transition-all ${isDragOverFav ? 'bg-amber-500/10 ring-1 ring-amber-500/40 p-1' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setIsDragOverFav(true) }}
          onDragLeave={() => setIsDragOverFav(false)}
          onDrop={(e) => {
            e.preventDefault(); setIsDragOverFav(false)
            if (draggedChannel) {
              if (!favourites.some(f => f.id === draggedChannel.id)) {
                setFavourites(prev => [...prev, draggedChannel])
                setChannels(prev => prev.filter(c => c.id !== draggedChannel.id))
              }
              setDraggedChannel(null)
            }
          }}
        >
          <div className="flex items-center justify-between px-2 py-1 text-white/40 hover:text-white/70 cursor-pointer transition-colors text-xs font-semibold tracking-wide">
            <span className="flex items-center gap-1.5">
              <svg className="w-3.5 h-3.5 text-amber-400/70 shrink-0" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
              Favourites
            </span>
            {favourites.length > 0 && (
              <span className="text-[10px] text-amber-400/60 bg-amber-400/10 px-1.5 rounded-full font-bold">{favourites.length}</span>
            )}
          </div>
          {favourites.length === 0 ? (
            <div className="px-6 py-1.5 text-[11px] text-white/30 italic border border-dashed border-white/5 rounded mx-2 text-left">
              Drag channels here to star them
            </div>
          ) : (
            <div className="flex flex-col gap-0.5 mt-0.5">
              {favourites.map(c => (
                <div key={c.id} className={`w-full flex items-center justify-between px-6 py-1.5 rounded-md text-[13px] font-medium transition-colors group ${activeChannel === '# ' + c.name ? 'bg-[#0d9488]/20 text-[#2dd4bf] font-semibold' : 'text-white/80 hover:text-white hover:bg-white/4'}`}>
                  <button onClick={() => navigate(`/workspace/${tenantId}/c/${c.id}`)} className="flex items-center gap-2 flex-1 min-w-0 text-left bg-transparent border-none p-0 cursor-pointer text-inherit font-inherit">
                    <span className="text-amber-400/80 text-xs shrink-0">★</span>
                    <span className="truncate">{c.name}</span>
                  </button>
                  <button title="Remove from Favourites" onClick={(e) => { e.stopPropagation(); setFavourites(prev => prev.filter(f => f.id !== c.id)); setChannels(prev => [...prev, c]) }} className="opacity-0 group-hover:opacity-100 text-white/40 hover:text-amber-400 transition-all cursor-pointer bg-transparent border-none p-0 text-xs ml-1 shrink-0">✕</button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Channels */}
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between px-2 py-1 text-white/40 hover:text-white/70 cursor-pointer transition-colors text-xs font-semibold tracking-wide">
            <span className="flex items-center gap-1.5">
              <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 9l6 6 6-6"/></svg>
              Channels
            </span>
          </div>
          <div className="flex flex-col gap-0.5 mt-0.5">
            {channels.map(c => (
              <div
                key={c.id}
                draggable
                onDragStart={() => setDraggedChannel(c)}
                onDragEnd={() => setDraggedChannel(null)}
                className={`w-full flex items-center justify-between px-6 py-1.5 rounded-md text-[13px] font-medium transition-colors cursor-grab active:cursor-grabbing group ${activeChannel === '# ' + c.name ? 'bg-[#0d9488]/20 text-[#2dd4bf] font-semibold' : 'text-white/60 hover:text-white hover:bg-white/4'}`}
              >
                <button onClick={() => navigate(`/workspace/${tenantId}/c/${c.id}`)} className="flex items-center gap-2 flex-1 min-w-0 text-left bg-transparent border-none p-0 cursor-pointer text-inherit font-inherit">
                  <span className="text-white/30 shrink-0 text-lg font-light leading-none mb-0.5">#</span>
                  <span className={`truncate ${unreadStates[c.id] > 0 ? 'text-white font-bold' : ''}`}>{c.name}</span>
                  {unreadStates[c.id] > 0 && (
                    <span className="ml-2 bg-[#d81b60] text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center">{unreadStates[c.id]}</span>
                  )}
                </button>
                <button
                  title="Star Channel"
                  onClick={(e) => { e.stopPropagation(); if (!favourites.some(f => f.id === c.id)) { setFavourites(prev => [...prev, c]); setChannels(prev => prev.filter(ch => ch.id !== c.id)) } }}
                  className="opacity-0 group-hover:opacity-100 text-white/30 hover:text-amber-400 transition-all cursor-pointer bg-transparent border-none p-0 text-xs ml-1 shrink-0"
                >☆</button>
              </div>
            ))}
            <button onClick={() => setShowChannelWizard(true)} className="flex items-center gap-2 px-6 py-1.5 text-[13px] text-white/40 hover:text-white/70 transition-colors cursor-pointer text-left">
              <span>+</span> Add channel
            </button>
          </div>
        </div>

        {/* Direct Messages */}
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between px-2 py-1 text-white/40 hover:text-white/70 cursor-pointer transition-colors text-xs font-semibold tracking-wide">
            <span className="flex items-center gap-1.5">
              <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 9l6 6 6-6"/></svg>
              Direct messages
            </span>
          </div>
          <div className="flex flex-col gap-1 mt-0.5">
            <button
              onClick={() => {
                const myAccountId = userProfile?.id
                if (!myAccountId) return
                navigate(`/workspace/${tenantId}/dm/${myAccountId}`)
                setSelectedProfile({ name: ownerName, initials: ownerName ? ownerName[0].toUpperCase() : 'H', email: 'You' })
                setShowRightSidebar(true)
              }}
              className={`w-full flex items-center gap-3 px-6 py-2 rounded-md text-[14px] transition-colors cursor-pointer text-left font-medium ${activeChannel === ownerName + ' (you)' ? 'bg-[#0d9488]/20 text-[#2dd4bf] font-semibold' : 'text-white/80 hover:text-white hover:bg-white/4'}`}
            >
              <div className="relative w-6 h-6 rounded bg-[#d81b60] text-white font-bold text-[11px] flex items-center justify-center shrink-0">
                {ownerName ? ownerName[0].toUpperCase() : 'H'}
                <div className="absolute -bottom-1 -right-1 w-3 h-3 bg-[#0b0f12] rounded-full flex items-center justify-center group-hover:bg-[#11171d] transition-colors">
                  <div className="w-2.5 h-2.5 rounded-full bg-[#10b981]" />
                </div>
              </div>
              <span className="truncate">{ownerName}</span>
              <span className="text-[10px] px-1.5 py-0.5 bg-white/10 rounded text-white/50 ml-auto font-normal">you</span>
            </button>
            {invitedList.map((userObj, index) => {
              const displayName = userObj.name || userObj.email.split('@')[0]
              const isOnline = userObj.is_online // Assume true/false
              return (
                <button
                  key={index}
                  onClick={() => {
                    navigate(`/workspace/${tenantId}/dm/${userObj.account_id}`)
                    setSelectedProfile({ name: displayName, initials: displayName[0].toUpperCase(), email: userObj.email })
                    setShowRightSidebar(true)
                  }}
                  className={`w-full flex items-center gap-3 px-6 py-2 rounded-md text-[14px] transition-colors cursor-pointer text-left font-medium group ${activeChannel === 'DM: ' + displayName ? 'bg-[#0d9488]/20 text-[#2dd4bf] font-semibold' : 'text-white/70 hover:text-white hover:bg-white/4'}`}
                >
                  <div className="relative w-6 h-6 rounded bg-indigo-500 text-white font-bold text-[11px] flex items-center justify-center shrink-0">
                    {displayName[0].toUpperCase()}
                    <div className={`absolute -bottom-1 -right-1 w-3 h-3 rounded-full flex items-center justify-center transition-colors ${activeChannel === 'DM: ' + displayName ? 'bg-[#1a383b]' : 'bg-[#0b0f12] group-hover:bg-[#11171d]'}`}>
                      {isOnline ? (
                         <div className="w-2.5 h-2.5 rounded-full bg-[#10b981]" />
                      ) : (
                         <div className="w-1.5 h-1.5 rounded-full border-[1.5px] border-white/50 bg-transparent" />
                      )}
                    </div>
                  </div>
                  <span className="truncate">{displayName}</span>
                </button>
              )
            })}
            <button onClick={() => setShowInviteModal(true)} className="flex items-center gap-2 px-6 py-1.5 text-[13px] text-white/40 hover:text-white/70 transition-colors cursor-pointer text-left mt-0.5">
              <span>+</span> Invite people
            </button>
          </div>
        </div>

        {/* Apps */}
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between px-2 py-1 text-white/40 hover:text-white/70 cursor-pointer transition-colors text-xs font-semibold tracking-wide">
            <span className="flex items-center gap-1.5">
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 9l6 6 6-6"/></svg>
              Apps
            </span>
          </div>
          <button className="w-full flex items-center gap-2 px-6 py-1.5 rounded-md text-[13px] text-white/70 hover:text-white hover:bg-white/4 transition-colors cursor-pointer text-left">
            <div className="w-4 h-4 rounded bg-gradient-to-tr from-amber-400 via-rose-500 to-sky-500 flex items-center justify-center shrink-0 text-[9px] text-white font-black">✦</div>
            <span className="truncate">Slackbot</span>
          </button>
        </div>
      </div>

      {/* ── Footer User Profile ───────────────────────────── */}
      <div className="h-14 px-3 border-t border-white/5 bg-[#080b0e] flex items-center justify-between cursor-pointer hover:bg-white/4 transition-colors">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="relative w-8 h-8 rounded-lg bg-[#d81b60] text-white font-bold text-xs flex items-center justify-center shrink-0">
            {ownerName ? ownerName[0].toUpperCase() : 'H'}
            <div className="absolute -bottom-1 -right-1 w-3 h-3 bg-[#080b0e] rounded-full flex items-center justify-center">
              <div className="w-2.5 h-2.5 rounded-full bg-[#10b981]" />
            </div>
          </div>
          <div className="flex flex-col min-w-0 text-left">
            <span className="text-[13px] font-bold text-white truncate">{ownerName}</span>
            <span className="text-[10px] text-emerald-500 font-medium tracking-wide">Online</span>
          </div>
        </div>
        <svg className="w-3.5 h-3.5 text-white/40 shrink-0 mr-1" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </div>
    </aside>
  )
}
