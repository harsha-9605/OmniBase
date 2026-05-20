import { useRef, useEffect } from 'react'

export default function ChatArea({
  activeChannel,
  activeProjectId,
  dynamicAllChannelName,
  ownerName,
  channelMessages,
  newMessageText,
  setNewMessageText,
  handleSendMessage,
  channels,
  favourites,
  setShowMembersModal,
}) {
  const messagesEndRef = useRef(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [channelMessages])

  return (
    <div className="flex-1 flex flex-col overflow-hidden relative">

      {/* Channel title + sub-tabs */}
      <div className="px-6 pt-4 border-b border-white/5 shrink-0 bg-[#131619]">
        <div className="flex items-center justify-between mb-3">
          <h1 className="text-xl font-extrabold text-white tracking-tight flex items-center gap-1.5 text-left">
            {activeChannel}
          </h1>
          {(channels.find(c => c.id === activeProjectId)?.is_private ||
            favourites.find(c => c.id === activeProjectId)?.is_private) && (
            <button
              onClick={() => setShowMembersModal(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-[#2dd4bf] bg-[#0d9488]/10 hover:bg-[#0d9488]/20 border border-[#0d9488]/30 rounded-lg transition-colors cursor-pointer"
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                <circle cx="9" cy="7" r="4"></circle>
                <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
              </svg>
              Members
            </button>
          )}
        </div>
        <div className="flex items-center gap-6 text-xs font-semibold">
          <button className="pb-2.5 text-[#2dd4bf] border-b-2 border-[#2dd4bf] cursor-pointer">Messages</button>
          <button className="pb-2.5 text-white/50 hover:text-white/80 transition-colors cursor-pointer flex items-center gap-1.5">
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
              <line x1="12" y1="8" x2="12" y2="16"></line>
              <line x1="8" y1="12" x2="16" y2="12"></line>
            </svg>
            Add canvas
          </button>
          <button className="pb-2.5 text-white/50 hover:text-white/80 transition-colors cursor-pointer text-sm font-bold">+</button>
        </div>
      </div>

      {/* Scrollable message area */}
      <div className="flex-1 overflow-y-auto p-6 flex flex-col justify-between">

        {/* Welcome block */}
        <div className="mb-8 animate-fade-in-up">
          <div className="max-w-3xl text-left bg-[#181d22]/50 border border-white/5 rounded-xl p-8 hover:bg-[#1a2027]/70 transition-colors">
            <h2 className="text-3xl font-extrabold text-white mb-4 tracking-tight flex items-center gap-3">
              {activeChannel === '# ' + dynamicAllChannelName && <>👋 Welcome to #{dynamicAllChannelName}</>}
              {activeChannel === '# new-channel' && <>✨ Welcome to #new-channel</>}
              {activeChannel === '# fun&chat' && <>☕ Have a little chat!</>}
              {activeChannel === ownerName + ' (you)' && <>📝 This is your space</>}
              {activeChannel && !activeChannel.startsWith('#') && !activeChannel.startsWith('DM:') && activeChannel !== ownerName + ' (you)' && <>💬 Conversation with {activeChannel}</>}
              {activeChannel && activeChannel.startsWith('DM:') && <>💬 Conversation with {activeChannel.replace('DM: ', '')}</>}
            </h2>
            <p className="text-[15px] text-white/70 leading-relaxed font-medium">
              {activeChannel === '# ' + dynamicAllChannelName && (
                <><strong>Everyone is here!</strong> Share announcements, updates about project news 📰, company news 🏢, or events 🎉 with your teammates.</>
              )}
              {activeChannel === '# new-channel' && (
                <>This channel is focused around a specific topic 🎯. You can keep all project-related information here so everyone can access it easily 📁.</>
              )}
              {activeChannel === '# fun&chat' && (
                <>Other channels are for work, but this is for relaxation 🌴. Take a break, share a joke 😂, and casually chat with the team.</>
              )}
              {activeChannel === ownerName + ' (you)' && (
                <>Draft your messages, keep links and files handy 🗂️. And remember, it's perfectly fine to talk to yourself here! 🤖💬</>
              )}
              {activeChannel && !activeChannel.startsWith('#') && !activeChannel.startsWith('DM:') && activeChannel !== ownerName + ' (you)' && (
                <>This is the beginning of your direct message history with <strong>{activeChannel}</strong>. Start a private conversation here 🔒.</>
              )}
              {activeChannel && activeChannel.startsWith('DM:') && (
                <>This is the beginning of your direct message history with <strong>{activeChannel.replace('DM: ', '')}</strong>. Start a private conversation here 🔒.</>
              )}
            </p>
          </div>
        </div>

        {/* Messages stream */}
        <div className="flex flex-col gap-4 mt-auto">
          <div className="flex items-center gap-3 my-2">
            <span className="flex-1 h-[1px] bg-white/5" />
            <span className="text-xs text-white/40 border border-white/8 rounded-full px-3 py-1 bg-[#131619] font-medium flex items-center gap-1">
              Today
              <svg className="w-3 h-3 text-white/40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 9l6 6 6-6"/></svg>
            </span>
            <span className="flex-1 h-[1px] bg-white/5" />
          </div>

          {channelMessages.map((msg) => (
            <div key={msg.id} className="flex items-start gap-3 animate-fade-in text-left">
              <div className="w-9 h-9 rounded-lg bg-[#d81b60] text-white font-extrabold text-sm flex items-center justify-center shrink-0 mt-0.5 shadow-sm">
                {msg.initials}
              </div>
              <div className="flex flex-col min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-bold text-white">{msg.sender}</span>
                  <span className="text-[11px] text-white/40 font-normal">{msg.time}</span>
                </div>
                <p className="text-[13px] text-white/80 mt-1 leading-relaxed">{msg.text}</p>
              </div>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Message input box */}
      <div className="p-4 pt-0 shrink-0 bg-[#131619]">
        <div className="bg-[#1b1f24] border border-white/10 rounded-xl flex flex-col focus-within:border-white/20 focus-within:shadow-[0_0_15px_rgba(45,212,191,0.1)] transition-all">
          {/* Formatting toolbar */}
          <div className="flex items-center gap-1.5 px-3 py-2 border-b border-white/5 text-white/40">
            <button className="p-1 hover:text-white hover:bg-white/5 rounded font-bold text-base transition-colors cursor-pointer">B</button>
            <button className="p-1 hover:text-white hover:bg-white/5 rounded font-serif italic text-base transition-colors cursor-pointer">I</button>
            <button className="p-1 hover:text-white hover:bg-white/5 rounded line-through text-base transition-colors cursor-pointer">S</button>
            <span className="w-[1px] h-4 bg-white/10 mx-1" />
            <button className="p-1 hover:text-white hover:bg-white/5 rounded text-base transition-colors cursor-pointer">🔗</button>
            <button className="p-1 hover:text-white hover:bg-white/5 rounded text-base transition-colors cursor-pointer">≣</button>
            <button className="p-1 hover:text-white hover:bg-white/5 rounded text-base transition-colors cursor-pointer">㋡</button>
            <button className="p-1 hover:text-white hover:bg-white/5 rounded font-mono text-base transition-colors cursor-pointer">&lt;/&gt;</button>
            <button className="p-1 hover:text-white hover:bg-white/5 rounded text-base transition-colors cursor-pointer">⁺</button>
          </div>

          {/* Text area */}
          <textarea
            rows="2"
            value={newMessageText}
            onChange={(e) => setNewMessageText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                handleSendMessage()
              }
            }}
            placeholder={`Message ${activeChannel}`}
            className="w-full bg-transparent text-white text-[13px] placeholder-white/30 p-3 resize-none focus:outline-none leading-relaxed"
          />

          {/* Bottom action row */}
          <div className="flex items-center justify-between px-3 py-2 border-t border-white/5">
            <div className="flex items-center gap-2 text-white/50">
              <button className="w-6 h-6 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center text-sm hover:text-white transition-colors cursor-pointer">+</button>
              <button className="p-1 hover:text-white transition-colors font-semibold text-base cursor-pointer">Aa</button>
              <button className="p-1 hover:text-white transition-colors text-base cursor-pointer">😊</button>
              <button className="p-1 hover:text-white transition-colors font-bold text-base cursor-pointer">@</button>
              <button className="p-1 hover:text-white transition-colors text-base cursor-pointer">📹</button>
              <button className="p-1 hover:text-white transition-colors text-base cursor-pointer">🎙</button>
              <button className="p-1 hover:text-white transition-colors text-base cursor-pointer">/</button>
            </div>
            <div className="flex items-center overflow-hidden rounded-md bg-[#0d9488] text-white">
              <button
                onClick={handleSendMessage}
                className="px-3 py-1 bg-[#0d9488] hover:bg-[#0f766e] transition-colors cursor-pointer font-bold text-base flex items-center justify-center"
              >➤</button>
              <span className="w-[1px] h-4 bg-teal-700" />
              <button className="px-1.5 py-1 bg-[#0d9488] hover:bg-[#0f766e] transition-colors cursor-pointer text-base flex items-center justify-center">
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M6 9l6 6 6-6"/></svg>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
