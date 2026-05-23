import { useRef, useEffect, useState, useMemo } from 'react'
import { supabase } from '../../supabaseClient'
import EmojiPicker from 'emoji-picker-react'
import { GiphyFetch } from '@giphy/js-fetch-api'
import { Grid } from '@giphy/react-components'
import { Mic, Paperclip, Smile, Square, File, Play, Image as ImageIcon, X, Check, Link as LinkIcon, Bold, Italic, Underline as UnderlineIcon, Strikethrough, Code as CodeIcon, ChevronDown, Calendar, Clock, MoreVertical, Edit2, Copy, Pin, Reply, Trash2 } from 'lucide-react'
import api from '../../api'

// TipTap
import { useEditor, EditorContent } from '@tiptap/react'
import { BubbleMenu } from '@tiptap/react/menus'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import Underline from '@tiptap/extension-underline'
import Placeholder from '@tiptap/extension-placeholder'
import CodeExtension from '@tiptap/extension-code'
import CodeBlock from '@tiptap/extension-code-block'
import Mention from '@tiptap/extension-mention'
import getSuggestionConfig from './MentionSuggestion'

const gf = new GiphyFetch(import.meta.env.VITE_GIPHY_API_KEY || 'sXpGFDGpz0Dv1V1jcO1969BvK5wE022M')

const formatDateSeparator = (dateStr) => {
  if (!dateStr) return 'Today'
  const date = new Date(dateStr)
  if (isNaN(date.getTime())) return 'Today'
  
  const dayName = date.toLocaleDateString([], { weekday: 'long' })
  const monthName = date.toLocaleDateString([], { month: 'long' })
  const dayNum = date.getDate()
  
  let suffix = 'th'
  if (dayNum === 1 || dayNum === 21 || dayNum === 31) suffix = 'st'
  else if (dayNum === 2 || dayNum === 22) suffix = 'nd'
  else if (dayNum === 3 || dayNum === 23) suffix = 'rd'
  
  return `${dayName}, ${monthName} ${dayNum}${suffix}`
}

function NestedReplies({ replies, depth, renderMessageRow }) {
  const [isExpanded, setIsExpanded] = useState(false)
  
  if (!replies || replies.length === 0) return null
  
  const repliers = Array.from(new Set(replies.map(r => r.sender))).slice(0, 3)
  
  return (
    <div className="mt-1 ml-4 border-l border-white/10 pl-4 flex flex-col gap-3">
      {/* Collapsible toggle */}
      <button 
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center gap-2 text-xs font-bold text-[#38bdf8] hover:text-[#0ea5e9] cursor-pointer text-left w-fit py-1 select-none bg-transparent border-none outline-none"
      >
        <span className="flex items-center gap-1.5">
          {isExpanded ? '▼' : '▶'}
          <span>{replies.length} {replies.length === 1 ? 'reply' : 'replies'}</span>
        </span>
        <div className="flex items-center gap-1 -ml-1">
          {repliers.map((initials, idx) => (
            <div key={idx} className="w-4 h-4 rounded-full bg-[#d81b60] text-white font-extrabold text-[8px] flex items-center justify-center border border-[#131619]">
              {initials ? initials[0].toUpperCase() : '?'}
            </div>
          ))}
        </div>
      </button>
      
      {/* Expanded list */}
      {isExpanded && (
        <div className="flex flex-col gap-3 mt-1">
          {replies.map(reply => renderMessageRow(reply, depth + 1))}
        </div>
      )}
    </div>
  )
}

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
  invitedList,
  userProfile,
  tenantId,
  setShowInviteModal,
}) {
  const messagesEndRef = useRef(null)
  
  const [showEmojiPicker, setShowEmojiPicker] = useState(false)
  const [showGifPicker, setShowGifPicker] = useState(false)
  
  // Audio Recording State
  const [isRecording, setIsRecording] = useState(false)
  const [recordingTime, setRecordingTime] = useState(0)
  const [recordedAudioBlob, setRecordedAudioBlob] = useState(null)
  const [recordedAudioUrl, setRecordedAudioUrl] = useState(null)
  const [isUploading, setIsUploading] = useState(false)
  
  const mediaRecorderRef = useRef(null)
  const audioChunksRef = useRef([])
  const recordingTimerRef = useRef(null)
  const fileInputRef = useRef(null)

  // Link Modal State
  const [showAddLinkModal, setShowAddLinkModal] = useState(false)
  const [linkText, setLinkText] = useState('')
  const [linkUrl, setLinkUrl] = useState('')

  // Schedule Message State
  const [showScheduleMenu, setShowScheduleMenu] = useState(false)
  const [showCustomTimeModal, setShowCustomTimeModal] = useState(false)
  const [customDate, setCustomDate] = useState('Today')
  const [customTime, setCustomTime] = useState('16:00') // 4:00 PM

  // Message Actions State
  const [editingMessageId, setEditingMessageId] = useState(null)
  const [editMessageText, setEditMessageText] = useState('')
  const [activeMenuMessageId, setActiveMenuMessageId] = useState(null)
  const [isSubmittingEdit, setIsSubmittingEdit] = useState(false)
  const [replyingToMessage, setReplyingToMessage] = useState(null)
  const [activeReactMessageId, setActiveReactMessageId] = useState(null)
  const [showReactionsModalMsg, setShowReactionsModalMsg] = useState(null)

  // Handlers
  const handleReact = async (messageId, emoji) => {
    try {
      await api.post(`/projects/${activeProjectId}/messages/${messageId}/react`, { emoji })
    } catch (e) {
      console.error('Failed to react:', e)
    }
  }

  const handleTogglePin = async (messageId) => {
    setActiveMenuMessageId(null)
    try {
      await api.post(`/projects/${activeProjectId}/messages/${messageId}/pin`)
    } catch (e) {
      console.error('Failed to pin/unpin:', e)
    }
  }

  const htmlToPlainText = (html) => {
    if (!html) return ''
    const tempDiv = document.createElement('div')
    tempDiv.innerHTML = html
    return tempDiv.innerText || tempDiv.textContent || ''
  }

  const plainTextToHtml = (text) => {
    if (!text) return ''
    return text.split('\n').map(line => `<p>${line}</p>`).join('')
  }

  const handleSaveEdit = async (messageId) => {
    if (!editMessageText.trim()) return
    setIsSubmittingEdit(true)
    try {
      const formattedHtml = plainTextToHtml(editMessageText)
      await api.patch(`/projects/${activeProjectId}/messages/${messageId}`, { content: formattedHtml })
      setEditingMessageId(null)
      setEditMessageText('')
    } catch (e) {
      console.error('Failed to edit:', e)
    } finally {
      setIsSubmittingEdit(false)
    }
  }
  const handleDeleteMessage = async (messageId) => {
    setActiveMenuMessageId(null)
    if (!confirm('Are you sure you want to delete this message?')) return
    try {
      await api.delete(`/projects/${activeProjectId}/messages/${messageId}`)
    } catch (e) {
      console.error('Failed to delete message:', e)
    }
  }

  const handleCopyMessageLink = (msg) => {
    setActiveMenuMessageId(null)
    const isDm = activeChannel.startsWith('DM:')
    const typePath = isDm ? 'dm' : 'c'
    const link = `${window.location.origin}/workspace/${tenantId}/${typePath}/${activeProjectId}#message-${msg.id}`
    navigator.clipboard.writeText(link)
  }
  const handleCopyMessage = (msg) => {
    setActiveMenuMessageId(null)
    // Create a temporary div to strip HTML tags if msg.text contains HTML
    const tempDiv = document.createElement('div')
    tempDiv.innerHTML = msg.text || ''
    navigator.clipboard.writeText(tempDiv.innerText || tempDiv.textContent)
  }

  const handleCopyLinks = (msg) => {
    setActiveMenuMessageId(null)
    const tempDiv = document.createElement('div')
    tempDiv.innerHTML = msg.text || ''
    const links = Array.from(tempDiv.querySelectorAll('a')).map(a => a.href).join('\\n')
    if (links) {
      navigator.clipboard.writeText(links)
    }
  }

  const hasLinks = (htmlContent) => {
    if (!htmlContent) return false
    return htmlContent.includes('<a ') || htmlContent.includes('href=')
  }

  // Click outside to close menus
  useEffect(() => {
    const handleClickOutside = (event) => {
      // 1. Message options menu
      if (activeMenuMessageId !== null) {
        const menuEl = document.querySelector('.message-menu-dropdown')
        const triggerButton = event.target.closest('.message-menu-trigger')
        if (menuEl && !menuEl.contains(event.target) && !triggerButton) {
          setActiveMenuMessageId(null)
        }
      }

      // 2. Emoji picker
      if (showEmojiPicker) {
        const emojiEl = document.querySelector('.emoji-picker-container')
        const emojiTrigger = event.target.closest('.emoji-picker-trigger')
        if (emojiEl && !emojiEl.contains(event.target) && !emojiTrigger) {
          setShowEmojiPicker(false)
        }
      }

      // 3. GIF picker
      if (showGifPicker) {
        const gifEl = document.querySelector('.gif-picker-container')
        const gifTrigger = event.target.closest('.gif-picker-trigger')
        if (gifEl && !gifEl.contains(event.target) && !gifTrigger) {
          setShowGifPicker(false)
        }
      }

      // 4. Schedule message menu
      if (showScheduleMenu) {
        const scheduleEl = document.querySelector('.schedule-menu-container')
        const scheduleTrigger = event.target.closest('.schedule-menu-trigger')
        if (scheduleEl && !scheduleEl.contains(event.target) && !scheduleTrigger) {
          setShowScheduleMenu(false)
        }
      }

      // 5. Active reaction picker
      if (activeReactMessageId !== null) {
        const reactEl = document.querySelector('.react-emoji-picker-container')
        const reactTrigger = event.target.closest('.hover-react-trigger')
        if (reactEl && !reactEl.contains(event.target) && !reactTrigger) {
          setActiveReactMessageId(null)
        }
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('touchstart', handleClickOutside)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('touchstart', handleClickOutside)
    }
  }, [activeMenuMessageId, showEmojiPicker, showGifPicker, showScheduleMenu, activeReactMessageId])

  const messageTree = useMemo(() => {
    const map = {}
    const roots = []
    
    // First pass: create mapping
    channelMessages.forEach(msg => {
      map[msg.id] = { ...msg, replies: [] }
    })
    
    // Second pass: link parent-child relationships
    channelMessages.forEach(msg => {
      const mapped = map[msg.id]
      if (msg.parent_id) {
        const parent = map[msg.parent_id]
        if (parent) {
          parent.replies.push(mapped)
        } else {
          // If parent is not in the active messages history list (archived/out of limit)
          roots.push(mapped)
        }
      } else {
        roots.push(mapped)
      }
    })
    
    return roots
  }, [channelMessages])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [channelMessages])

  const renderMessageRow = (msg, depth = 0) => {
    const isEditing = editingMessageId === msg.id

    return (
      <div key={msg.id} className="flex flex-col">
        <div id={`message-${msg.id}`} className={`group flex items-start gap-3 animate-fade-in text-left relative hover:bg-white/[0.02] ${depth > 0 ? 'ml-4' : '-mx-4 px-4'} py-2 rounded-lg transition-colors ${msg.is_pinned ? 'bg-orange-500/5' : ''}`}>
          
          {/* Message Hover Actions */}
          <div className="absolute right-4 top-2 opacity-0 group-hover:opacity-100 transition-opacity bg-[#222222] border border-white/10 rounded-lg shadow-xl flex items-center p-1 gap-1 z-10">
             <button onClick={() => handleReact(msg.id, '✅')} className="w-8 h-8 flex items-center justify-center rounded hover:bg-white/10 text-white/70 hover:text-white transition-colors">✅</button>
             <button onClick={() => handleReact(msg.id, '👀')} className="w-8 h-8 flex items-center justify-center rounded hover:bg-white/10 text-white/70 hover:text-white transition-colors">👀</button>
             <button onClick={() => handleReact(msg.id, '🙌')} className="w-8 h-8 flex items-center justify-center rounded hover:bg-white/10 text-white/70 hover:text-white transition-colors">🙌</button>
             
             <div className="w-[1px] h-4 bg-white/10 mx-0.5"></div>
             
             {/* React trigger */}
             <button onClick={() => setActiveReactMessageId(activeReactMessageId === msg.id ? null : msg.id)} className="hover-react-trigger px-2 h-8 flex items-center gap-1 text-[12px] font-semibold text-white/70 hover:text-white hover:bg-white/10 rounded transition-colors cursor-pointer">
               <Smile size={14} /> React
             </button>

             {/* Reply trigger */}
             <button onClick={() => setReplyingToMessage(msg)} className="px-2 h-8 flex items-center gap-1 text-[12px] font-semibold text-white/70 hover:text-white hover:bg-white/10 rounded transition-colors cursor-pointer">
               <Reply size={14} /> Reply
             </button>

             <div className="w-[1px] h-4 bg-white/10 mx-0.5"></div>

             {/* More options */}
             <button onClick={() => setActiveMenuMessageId(activeMenuMessageId === msg.id ? null : msg.id)} className="message-menu-trigger w-8 h-8 flex items-center justify-center rounded hover:bg-white/10 text-white/70 hover:text-white transition-colors relative">
                <MoreVertical size={16} />
             </button>
          </div>

          {/* Per-message Emoji Picker */}
          {activeReactMessageId === msg.id && (
            <div className="react-emoji-picker-container absolute right-4 bottom-10 z-50 shadow-2xl">
              <EmojiPicker onEmojiClick={(emojiData) => { handleReact(msg.id, emojiData.emoji); setActiveReactMessageId(null); }} theme="dark" />
            </div>
          )}

          {/* 3-Dots Menu Dropdown */}
          {activeMenuMessageId === msg.id && (
            <div className="message-menu-dropdown absolute right-4 bottom-10 w-64 bg-[#222222] border border-white/10 rounded-lg shadow-2xl py-1 z-50 animate-fade-in">
              <div className="px-3 py-1.5 text-[11px] font-bold text-white/40 uppercase tracking-wider">Message Options</div>
              {(msg.account_id === userProfile?.id || msg.sender === ownerName) && (
                <button onClick={() => { setEditingMessageId(msg.id); setEditMessageText(htmlToPlainText(msg.text)); setActiveMenuMessageId(null); }} className="w-full px-4 py-2 text-sm text-left text-white/80 hover:bg-[#38bdf8] hover:text-white flex items-center gap-2">
                  <Edit2 size={14} /> Edit message
                </button>
              )}
              <button onClick={() => handleCopyMessageLink(msg)} className="w-full px-4 py-2 text-sm text-left text-white/80 hover:bg-[#38bdf8] hover:text-white flex items-center gap-2">
                <LinkIcon size={14} /> Copy link
              </button>
              {hasLinks(msg.text) && (
                <button onClick={() => handleCopyLinks(msg)} className="w-full px-4 py-2 text-sm text-left text-white/80 hover:bg-[#38bdf8] hover:text-white flex items-center gap-2">
                  <LinkIcon size={14} /> Copy links in message
                </button>
              )}
              <button onClick={() => handleCopyMessage(msg)} className="w-full px-4 py-2 text-sm text-left text-white/80 hover:bg-[#38bdf8] hover:text-white flex items-center gap-2">
                <Copy size={14} /> Copy message
              </button>
              {(msg.account_id === userProfile?.id || msg.sender === ownerName) && (
                <button onClick={() => handleDeleteMessage(msg.id)} className="w-full px-4 py-2 text-sm text-left text-red-400 hover:bg-red-500 hover:text-white flex items-center gap-2 transition-colors">
                  <Trash2 size={14} /> Delete message
                </button>
              )}
              <div className="h-[1px] bg-white/10 my-1"></div>
              <div className="px-3 py-1 text-[11px] font-bold text-white/40 uppercase tracking-wider">Organize</div>
              <button onClick={() => handleTogglePin(msg.id)} className="w-full px-4 py-2 text-sm text-left text-white/80 hover:bg-orange-500 hover:text-white flex items-center gap-2">
                <Pin size={14} /> {msg.is_pinned ? 'Unpin from channel' : 'Pin to channel'}
              </button>
            </div>
          )}

          <div className="w-9 h-9 rounded-lg bg-[#d81b60] text-white font-extrabold text-sm flex items-center justify-center shrink-0 mt-0.5 shadow-sm">
            {msg.initials}
          </div>
          <div className="flex flex-col min-w-0 flex-1">
            {msg.is_pinned && (
              <div className="flex items-center gap-1 text-[11px] font-bold text-orange-500 mb-1">
                <Pin size={10} /> Pinned
              </div>
            )}
            <div className="flex items-center gap-2">
              <span className="text-[13px] font-bold text-white">{msg.sender}</span>
              <span className="text-[11px] text-white/40 font-normal">{msg.time}</span>
              {msg.is_edited && <span className="text-[11px] text-white/30">(edited)</span>}
            </div>
            
            {/* Render Text Content or Edit Box */}
            {isEditing ? (
              <div className="mt-2 bg-[#1b1f24] p-3 rounded-lg border border-white/10">
                <textarea 
                  value={editMessageText} 
                  onChange={(e) => setEditMessageText(e.target.value)} 
                  className="w-full bg-transparent text-white text-[14px] outline-none resize-y min-h-[60px]" 
                  autoFocus
                />
                <div className="flex justify-end gap-2 mt-2">
                  <button onClick={() => { setEditingMessageId(null); setEditMessageText(''); }} className="px-3 py-1 text-xs font-medium text-white/70 hover:text-white bg-white/5 hover:bg-white/10 rounded">Cancel</button>
                  <button onClick={() => handleSaveEdit(msg.id)} disabled={isSubmittingEdit} className="px-3 py-1 text-xs font-medium text-white bg-green-600 hover:bg-green-500 rounded disabled:opacity-50">Save changes</button>
                </div>
              </div>
            ) : (
              msg.text && msg.file_type !== 'gif' && (
                <div className="text-[14px] text-white/90 mt-1 leading-relaxed [&>p]:my-0 [&_a]:text-[#38bdf8] [&_a]:underline [&_pre]:bg-[#181d22] [&_pre]:border [&_pre]:border-white/5 [&_pre]:rounded-lg [&_pre]:p-3 [&_pre]:font-mono [&_pre]:text-[13px] [&_pre]:my-2 [&_code]:bg-[#1b1f24] [&_code]:text-[#f97316] [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_code]:border [&_code]:border-white/10 [&_pre_code]:bg-transparent [&_pre_code]:text-inherit [&_pre_code]:border-none [&_pre_code]:p-0" dangerouslySetInnerHTML={{ __html: msg.text }} />
              )
            )}

            {/* Render Attachments */}
            {msg.file_url && (
              <div className="mt-2">
                {msg.file_type === 'audio' && (
                  <div className="bg-[#1b1f24] border border-white/10 rounded-lg p-3 inline-flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-[#38bdf8] text-white flex items-center justify-center">
                      <Play size={16} fill="currentColor" />
                    </div>
                    <audio controls src={msg.file_url} className="h-8 w-48" />
                  </div>
                )}
                {msg.file_type === 'pdf' && (
                  <a href={msg.file_url} target="_blank" rel="noopener noreferrer" className="bg-[#1b1f24] border border-white/10 hover:border-white/30 transition-colors rounded-lg p-3 inline-flex items-center gap-3">
                    <div className="w-8 h-8 rounded-md bg-red-500/20 text-red-400 flex items-center justify-center">
                      <File size={16} />
                    </div>
                    <span className="text-[13px] font-medium text-white/80 underline">View PDF Document</span>
                  </a>
                )}
                {msg.file_type === 'gif' && (
                  <img src={msg.file_url} alt="GIF" className="rounded-lg max-h-48 border border-white/10" />
                )}
                {msg.file_type === 'file' && (
                  <a href={msg.file_url} target="_blank" rel="noopener noreferrer" className="text-[#2dd4bf] text-[13px] hover:underline flex items-center gap-1.5">
                    <Paperclip size={14} /> Download File
                  </a>
                )}
              </div>
            )}
            
            {/* Render Reactions */}
            {msg.reactions && msg.reactions.length > 0 && (
              <div className="flex flex-wrap items-center gap-1 mt-2">
                {Array.from(new Set(msg.reactions.map(r => r.emoji))).map(emoji => {
                  const count = msg.reactions.filter(r => r.emoji === emoji).length;
                  const hasReacted = msg.reactions.some(r => r.emoji === emoji && r.sender_name === ownerName);
                  const userNames = msg.reactions.filter(r => r.emoji === emoji).map(r => r.sender_name).join(', ');
                  return (
                    <button 
                      key={emoji}
                      onClick={() => handleReact(msg.id, emoji)}
                      className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-bold transition-colors border ${hasReacted ? 'bg-[#38bdf8]/20 border-[#38bdf8]/50 text-[#38bdf8]' : 'bg-[#1b1f24] border-white/10 text-white/70 hover:bg-white/5 hover:border-white/20'}`}
                      title={`Reacted by: ${userNames}`}
                    >
                      <span>{emoji}</span>
                      <span>{count}</span>
                    </button>
                  )
                })}
                <button 
                  onClick={() => setShowReactionsModalMsg(msg)}
                  className="w-5 h-5 rounded-full border border-white/10 text-white/50 hover:text-white hover:bg-white/10 flex items-center justify-center text-[10px] cursor-pointer"
                  title="View who reacted"
                >
                  ℹ️
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Render nested replies collapsible */}
        {msg.replies && msg.replies.length > 0 && (
          <NestedReplies 
            replies={msg.replies} 
            depth={depth} 
            renderMessageRow={renderMessageRow} 
          />
        )}
      </div>
    )
  }

  const placeholderText = useMemo(() => `Message ${activeChannel || ''}`, [activeChannel])

  const mentionItems = useMemo(() => {
    return [
      { id: 'channel', label: 'channel', isSpecial: true, description: 'Notify everyone in this channel.' },
      { id: 'here', label: 'here', isSpecial: true, description: 'Notify every online member in this channel.' },
      { id: 'you', label: `${ownerName} (you)`, isSpecial: false },
      ...(invitedList || []).map(u => ({ id: u.account_id || u.id, label: u.name, isSpecial: false }))
    ]
  }, [ownerName, invitedList])

  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      Link.configure({
        openOnClick: false,
        HTMLAttributes: {
          class: 'text-[#38bdf8] bg-[#0ea5e9]/20 hover:underline cursor-pointer px-0.5 rounded',
        },
      }),
      Placeholder.configure({
        placeholder: placeholderText,
        emptyEditorClass: 'is-editor-empty',
      }),
      CodeExtension.configure({
        HTMLAttributes: {
          class: 'bg-[#1b1f24] text-[#f97316] px-1 py-0.5 rounded border border-white/10 font-mono text-[13px]',
        },
      }),
      CodeBlock.configure({
        HTMLAttributes: {
          class: 'bg-[#181d22] border border-white/5 rounded-lg p-3 font-mono text-[13px] text-white/90 overflow-x-auto my-2 block',
        },
      }),
      Mention.configure({
        HTMLAttributes: {
          class: 'text-[#38bdf8] bg-[#0ea5e9]/10 font-bold px-1 rounded cursor-pointer',
        },
        suggestion: getSuggestionConfig(mentionItems),
      }),
    ],
    editorProps: {
      handleKeyDown: (view, event) => {
        if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault()
          handleSendWrapper()
          return true
        }
        return false
      }
    },
    content: newMessageText,
    onUpdate: ({ editor }) => {
      setNewMessageText(editor.getHTML())
    },
  }, [mentionItems])

  // Keep TipTap placeholder synced and content cleared if newMessageText clears from outside
  useEffect(() => {
    if (editor) {
      if (editor.extensionManager.extensions.find(e => e.name === 'placeholder')) {
        editor.extensionManager.extensions.find(e => e.name === 'placeholder').options.placeholder = placeholderText
        editor.view.dispatch(editor.state.tr)
      }
      
      if (newMessageText === '' && editor.getHTML() !== '<p></p>') {
        editor.commands.clearContent()
      }
    }
  }, [placeholderText, editor, newMessageText])

  const handleOpenAddLink = () => {
    if (!editor) return
    const { from, to } = editor.state.selection
    const selectedText = editor.state.doc.textBetween(from, to, ' ')
    setLinkText(selectedText)
    setLinkUrl(editor.getAttributes('link').href || '')
    setShowAddLinkModal(true)
  }

  const handleSaveLink = () => {
    if (linkUrl) {
      let finalUrl = linkUrl
      if (!/^https?:\/\//i.test(finalUrl)) {
        finalUrl = `http://${finalUrl}`
      }
      if (linkText) {
        editor.chain().focus().insertContent(`<a href="${finalUrl}">${linkText}</a>`).run()
      } else {
        editor.chain().focus().extendMarkRange('link').setLink({ href: finalUrl }).run()
      }
    } else {
      editor.chain().focus().unsetLink().run()
    }
    setShowAddLinkModal(false)
  }

  // --- AUDIO RECORDING ---
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const options = { audioBitsPerSecond: 16000 } // keep size < 1MB
      mediaRecorderRef.current = new MediaRecorder(stream, options)
      
      mediaRecorderRef.current.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data)
        }
      }

      mediaRecorderRef.current.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' })
        audioChunksRef.current = []
        setRecordedAudioBlob(audioBlob)
        setRecordedAudioUrl(URL.createObjectURL(audioBlob))
      }

      mediaRecorderRef.current.start()
      setIsRecording(true)
      setRecordingTime(0)
      setRecordedAudioBlob(null)
      setRecordedAudioUrl(null)
      
      recordingTimerRef.current = setInterval(() => {
        setRecordingTime(prev => {
          if (prev >= 59) {
            stopRecording()
            return 60
          }
          return prev + 1
        })
      }, 1000)
    } catch (err) {
      console.error('Microphone access denied', err)
      alert('Microphone access is required to record audio.')
    }
  }

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop()
      mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop())
      setIsRecording(false)
      clearInterval(recordingTimerRef.current)
    }
  }

  const cancelRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop()
      mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop())
      setIsRecording(false)
      clearInterval(recordingTimerRef.current)
      audioChunksRef.current = []
      setRecordedAudioBlob(null)
      setRecordedAudioUrl(null)
    }
  }

  const clearAudioPreview = () => {
    setRecordedAudioBlob(null)
    setRecordedAudioUrl(null)
  }

  // --- FILE UPLOAD TO SUPABASE ---
  const handleSendWrapper = async () => {
    const textEmpty = !newMessageText || newMessageText === '<p></p>' || newMessageText.trim() === ''
    if (!recordedAudioBlob && textEmpty) return;

    const pId = replyingToMessage?.id || null;

    if (recordedAudioBlob) {
      setIsUploading(true)
      try {
        const fileName = `audio_${Date.now()}.webm`
        const bucketName = import.meta.env.VITE_SUPABASE_BUCKET || 'OmniBase-media'
        
        const { data, error } = await supabase.storage.from(bucketName).upload(fileName, recordedAudioBlob)
        if (error) {
          if (error.message.includes('Bucket not found')) {
            alert(`Upload failed: The bucket "${bucketName}" does not exist in your Supabase project. Please create it and set it to public.`)
          } else {
            throw error
          }
          setIsUploading(false)
          return
        }

        const { data: publicUrlData } = supabase.storage.from(bucketName).getPublicUrl(fileName)
        handleSendMessage(newMessageText, publicUrlData.publicUrl, 'audio', pId)
        clearAudioPreview()
        setReplyingToMessage(null)
      } catch (err) {
        console.error('Upload failed', err)
        alert('Failed to upload audio. Check console for details.')
      }
      setIsUploading(false)
    } else {
      handleSendMessage(newMessageText, null, null, pId)
      setReplyingToMessage(null)
    }
  }

  const handleFileUpload = async (e) => {
    const file = e.target.files[0]
    if (!file) return
    const ext = file.name.split('.').pop()
    const isAudio = file.type.includes('audio') || ext === 'mp3' || ext === 'm4a'
    const isPdf = file.type.includes('pdf') || ext === 'pdf'
    
    let fType = 'file'
    if (isAudio) fType = 'audio'
    if (isPdf) fType = 'pdf'
    
    try {
      const fileName = `upload_${Date.now()}.${ext}`
      const bucketName = import.meta.env.VITE_SUPABASE_BUCKET || 'OmniBase-media'
      
      const { data, error } = await supabase.storage.from(bucketName).upload(fileName, file)
      if (error) {
        if (error.message.includes('Bucket not found')) {
          alert(`Upload failed: The bucket "${bucketName}" does not exist in your Supabase project.`)
        } else {
          throw error
        }
        return
      }
      const { data: publicUrlData } = supabase.storage.from(bucketName).getPublicUrl(fileName)
      const pId = replyingToMessage?.id || null
      handleSendMessage(fType === 'audio' ? '🎤 Voice Message' : '📎 File Attached', publicUrlData.publicUrl, fType, pId)
      setReplyingToMessage(null)
    } catch(err) {
      console.error(err)
      alert('Failed to upload file.')
    }
  }

  // --- EMOJIS & GIFS ---
  const onEmojiClick = (emojiData) => {
    if (editor) {
      editor.chain().focus().insertContent(emojiData.emoji).run()
    }
    setShowEmojiPicker(false)
  }

  const onGifClick = (gif, e) => {
    e.preventDefault()
    const pId = replyingToMessage?.id || null
    handleSendMessage('Sent a GIF', gif.images.fixed_height.url, 'gif', pId)
    setReplyingToMessage(null)
    setShowGifPicker(false)
  }

  const fetchGifs = (offset) => gf.trending({ offset, limit: 10 })

  return (
    <div className="flex-1 flex flex-col overflow-hidden relative">
      <style>{`
        .ProseMirror p.is-editor-empty:first-child::before {
          content: attr(data-placeholder);
          float: left;
          color: rgba(255, 255, 255, 0.3);
          pointer-events: none;
          height: 0;
        }
        .ProseMirror {
          outline: none;
          min-height: 24px;
        }
        .ProseMirror p {
          margin: 0;
          white-space: pre-wrap;
        }
        .ProseMirror pre {
          background: #181d22;
          border: 1px solid rgba(255,255,255,0.05);
          border-radius: 0.5rem;
          padding: 0.75rem;
          font-family: monospace;
          margin: 0.5rem 0;
        }
        .ProseMirror code {
          background: #1b1f24;
          color: #f97316;
          padding: 0.125rem 0.25rem;
          border-radius: 0.25rem;
          border: 1px solid rgba(255,255,255,0.1);
        }
        .ProseMirror pre code {
          background: transparent;
          color: inherit;
          padding: 0;
          border: none;
        }
      `}</style>

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
        </div>
      </div>

      {/* Scrollable message area */}
      <div className="flex-1 overflow-y-auto flex flex-col" style={{minHeight:0}}>

        {/* Welcome block */}
        <div className="px-8 pt-8 pb-6 animate-fade-in-up select-none">
          {activeChannel && activeChannel.startsWith('#') ? (
            // Workspace Channels welcome block
            <div className="flex flex-col gap-3">
              {/* Large hero heading like Slack */}
              <div className="mb-1">
                {/* fun&chat visual banner — shows pictures at the top so people know what the channel is for */}
                {activeChannel === '# fun&chat' && (
                  <div className="flex items-center gap-3 mb-5 p-4 rounded-2xl border border-[#f97316]/20 overflow-hidden relative"
                    style={{ background: 'linear-gradient(135deg, rgba(124,45,18,0.25), rgba(154,52,18,0.12))' }}>
                    {/* Decorative large emojis */}
                    <div className="flex gap-2 flex-wrap">
                      {['🎉','😂','🌴','🎮','🍕','🎬','🎵','🏆','🤣','🎨','🐶','🌊','🎭','🍿','✨'].map((em, i) => (
                        <span key={i} className="text-2xl select-none" style={{ animationDelay: `${i*0.05}s` }}>{em}</span>
                      ))}
                    </div>
                    <div className="absolute right-4 top-1/2 -translate-y-1/2 text-[10px] font-bold text-[#f97316]/60 uppercase tracking-widest">Fun &amp; Vibes Only</div>
                  </div>
                )}
                <h2 className="text-4xl font-black text-white tracking-tight leading-tight">
                  {activeChannel === '# ' + dynamicAllChannelName || activeChannel === '# general' ? (
                    <>Everyone's all here in <span className="text-[#2dd4bf]">{activeChannel}</span> 🌟</>
                  ) : activeChannel === '# fun&chat' ? (
                    <>Welcome to <span className="text-[#f97316]">{activeChannel}</span> 🌴</>
                  ) : (
                    <>Welcome to <span className="text-[#2dd4bf]">{activeChannel}</span> ✨</>
                  )}
                </h2>
                <p className="text-[15.5px] text-white/60 leading-relaxed font-medium mt-3 max-w-2xl">
                  {activeChannel === '# ' + dynamicAllChannelName || activeChannel === '# general' ? (
                    <>Share announcements and updates about company news, upcoming events, or teammates who deserve some kudos. ⭐️</>
                  ) : activeChannel === '# new-channel' ? (
                    <>This channel is focused around a specific topic 🎯. Keep all project-related information here so everyone can access it easily 📁.</>
                  ) : activeChannel === '# fun&chat' ? (
                    <>Other channels are for work, but this one is for relaxation 🌴. Take a break, share a joke 😂, and casually chat with the team.</>
                  ) : (
                    <>This is the very beginning of the <strong className="text-white/80">{activeChannel}</strong> channel. Use it to collaborate and share updates! 🚀</>
                  )}
                </p>
              </div>

              {/* Divider */}
              <div className="h-px bg-white/5 my-2" />

              {/* Cards layout — horizontally filling, Slack-like */}
              <div className="flex gap-4 flex-wrap">
                {activeChannel === '# fun&chat' ? (
                  <>
                    {/* fun&chat introductory onboarding cards */}
                    {/* Card 1: Send a GIF */}
                    <div 
                      onClick={() => {
                        setShowGifPicker(true);
                        setShowEmojiPicker(false);
                      }}
                      className="flex-1 min-w-[200px] max-w-[300px] h-[260px] rounded-2xl border border-[#c2410c]/30 p-5 flex flex-col justify-between cursor-pointer transition-all hover:scale-[1.02] hover:border-white/20 overflow-hidden hover:shadow-[0_16px_36px_rgba(124,45,18,0.4)] shadow-xl"
                      style={{ background: 'linear-gradient(135deg, #7c2d12, #3c1206)' }}
                    >
                      <div className="flex flex-col text-left">
                        <div className="text-[16px] font-extrabold text-white tracking-tight leading-tight">Send a GIF</div>
                        <div className="text-[11.5px] text-white/55 font-semibold mt-1 leading-snug">Express yourself in chat</div>
                      </div>
                      
                      {/* Mock Giphy UI inside the card */}
                      <div className="bg-[#131619] border border-white/5 rounded-t-xl p-3 flex flex-col gap-2 w-full mt-4 translate-y-3 shrink-0 shadow-2xl">
                        {/* Tabs */}
                        <div className="flex border-b border-white/5 text-[10px] pb-1 font-semibold text-white/35 justify-between">
                          <span className="opacity-70">😊 Emoji</span>
                          <span className="text-white border-b border-indigo-400 relative font-extrabold">
                            🖼️ GIFs
                            <div className="absolute right-[-4px] bottom-[-10px] z-10 scale-75">
                              👉
                            </div>
                          </span>
                        </div>
                        
                        {/* Faux Search Bar */}
                        <div className="bg-white/5 border border-white/8 rounded px-2 py-1.5 text-[9px] text-white/30 flex items-center gap-1">
                          <span>🔍</span> Search GIPHY
                        </div>
                        
                        {/* Faux Grid Items */}
                        <div className="grid grid-cols-3 gap-1 h-14 overflow-hidden">
                          <div className="bg-blue-400/15 border border-blue-400/20 rounded flex items-center justify-center text-[11px]">✨</div>
                          <div className="bg-emerald-400/15 border border-emerald-400/20 rounded flex items-center justify-center text-[11px]">🔥</div>
                          <div className="bg-purple-400/15 border border-purple-400/20 rounded flex items-center justify-center text-[11px]">🎉</div>
                        </div>
                      </div>
                    </div>

                    {/* Card 2: Invite teammates */}
                    <div 
                      onClick={() => setShowInviteModal(true)}
                      className="flex-1 min-w-[200px] max-w-[300px] h-[260px] rounded-2xl border border-[#6b21a8]/35 p-5 flex flex-col justify-between cursor-pointer transition-all hover:scale-[1.02] hover:border-white/20 overflow-hidden hover:shadow-[0_16px_36px_rgba(88,28,135,0.4)] shadow-xl"
                      style={{ background: 'linear-gradient(135deg, #3b0764, #120024)' }}
                    >
                      <div className="flex flex-col text-left">
                        <div className="text-[16px] font-extrabold text-white tracking-tight leading-tight">Invite teammates</div>
                        <div className="text-[11.5px] text-white/55 font-semibold mt-1 leading-snug">Add your whole team</div>
                      </div>
                      
                      {/* Overlapping Avatars Mockup inside the card */}
                      <div className="flex items-center justify-center h-32 relative mt-4 w-full translate-y-2">
                        {/* Avatar 1 (Green bg) */}
                        <div className="absolute left-[20px] top-[14px] w-16 h-16 rounded-full bg-[#10b981] flex items-center justify-center text-white border-2 border-[#1e053a] shadow-md z-10">
                          <svg className="w-12 h-12" viewBox="0 0 100 100" fill="none">
                            <circle cx="50" cy="50" r="40" fill="#fbcfe8" />
                            <circle cx="38" cy="45" r="3" fill="#334155" />
                            <circle cx="62" cy="45" r="3" fill="#334155" />
                            <path d="M42 60 Q50 66 58 60" stroke="#334155" strokeWidth="4" strokeLinecap="round" fill="none" />
                            <path d="M20 30 Q30 20 40 25 T60 20 T80 30" stroke="#78350f" strokeWidth="12" strokeLinecap="round" fill="none" />
                          </svg>
                        </div>

                        {/* Avatar 2 (Blue bg) */}
                        <div className="absolute right-[20px] top-[14px] w-16 h-16 rounded-full bg-[#3b82f6] flex items-center justify-center text-white border-2 border-[#1e053a] shadow-md z-10">
                          <svg className="w-12 h-12" viewBox="0 0 100 100" fill="none">
                            <circle cx="50" cy="50" r="40" fill="#fed7aa" />
                            <rect x="28" y="38" width="16" height="12" rx="3" stroke="#334155" strokeWidth="3" fill="none" />
                            <rect x="56" y="38" width="16" height="12" rx="3" stroke="#334155" strokeWidth="3" fill="none" />
                            <line x1="44" y1="44" x2="56" y2="44" stroke="#334155" strokeWidth="3" />
                            <path d="M42 60 Q50 66 58 60" stroke="#334155" strokeWidth="4" strokeLinecap="round" fill="none" />
                            <path d="M25 35 Q50 15 75 35" stroke="#1e293b" strokeWidth="10" fill="none" />
                          </svg>
                        </div>

                        {/* Avatar 3 (Orange bg) */}
                        <div className="absolute bottom-[5px] w-16 h-16 rounded-full bg-[#fb923c] flex items-center justify-center text-white border-2 border-[#1e053a] shadow-lg z-20">
                          <svg className="w-12 h-12" viewBox="0 0 100 100" fill="none">
                            <circle cx="50" cy="50" r="40" fill="#fcd34d" />
                            <circle cx="38" cy="45" r="3" fill="#334155" />
                            <circle cx="62" cy="45" r="3" fill="#334155" />
                            <path d="M42 60 Q50 66 58 60" stroke="#334155" strokeWidth="4" strokeLinecap="round" fill="none" />
                            <path d="M22 40 C22 20, 78 20, 78 40" stroke="#ec4899" strokeWidth="10" fill="none" />
                          </svg>
                        </div>
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    {/* Standard Channels Cards */}
                    {/* Card 1: Invite teammates */}
                    <div 
                      onClick={() => setShowInviteModal(true)}
                      className="flex-1 min-w-[200px] max-w-[300px] h-[260px] rounded-2xl border border-[#6b21a8]/35 p-5 flex flex-col justify-between cursor-pointer transition-all hover:scale-[1.02] hover:border-white/20 overflow-hidden hover:shadow-[0_16px_36px_rgba(88,28,135,0.4)] shadow-xl"
                      style={{ background: 'linear-gradient(135deg, #3b0764, #120024)' }}
                    >
                      <div className="flex flex-col text-left">
                        <div className="text-[16px] font-extrabold text-white tracking-tight leading-tight">Invite teammates</div>
                        <div className="text-[11.5px] text-white/55 font-semibold mt-1 leading-snug">Add your whole team</div>
                      </div>
                      
                      {/* Overlapping Avatars Mockup inside the card */}
                      <div className="flex items-center justify-center h-32 relative mt-4 w-full translate-y-2">
                        {/* Avatar 1 (Green bg) */}
                        <div className="absolute left-[20px] top-[14px] w-16 h-16 rounded-full bg-[#10b981] flex items-center justify-center text-white border-2 border-[#1e053a] shadow-md z-10">
                          <svg className="w-12 h-12" viewBox="0 0 100 100" fill="none">
                            <circle cx="50" cy="50" r="40" fill="#fbcfe8" />
                            <circle cx="38" cy="45" r="3" fill="#334155" />
                            <circle cx="62" cy="45" r="3" fill="#334155" />
                            <path d="M42 60 Q50 66 58 60" stroke="#334155" strokeWidth="4" strokeLinecap="round" fill="none" />
                            <path d="M20 30 Q30 20 40 25 T60 20 T80 30" stroke="#78350f" strokeWidth="12" strokeLinecap="round" fill="none" />
                          </svg>
                        </div>

                        {/* Avatar 2 (Blue bg) */}
                        <div className="absolute right-[20px] top-[14px] w-16 h-16 rounded-full bg-[#3b82f6] flex items-center justify-center text-white border-2 border-[#1e053a] shadow-md z-10">
                          <svg className="w-12 h-12" viewBox="0 0 100 100" fill="none">
                            <circle cx="50" cy="50" r="40" fill="#fed7aa" />
                            <rect x="28" y="38" width="16" height="12" rx="3" stroke="#334155" strokeWidth="3" fill="none" />
                            <rect x="56" y="38" width="16" height="12" rx="3" stroke="#334155" strokeWidth="3" fill="none" />
                            <line x1="44" y1="44" x2="56" y2="44" stroke="#334155" strokeWidth="3" />
                            <path d="M42 60 Q50 66 58 60" stroke="#334155" strokeWidth="4" strokeLinecap="round" fill="none" />
                            <path d="M25 35 Q50 15 75 35" stroke="#1e293b" strokeWidth="10" fill="none" />
                          </svg>
                        </div>

                        {/* Avatar 3 (Orange bg) */}
                        <div className="absolute bottom-[5px] w-16 h-16 rounded-full bg-[#fb923c] flex items-center justify-center text-white border-2 border-[#1e053a] shadow-lg z-20">
                          <svg className="w-12 h-12" viewBox="0 0 100 100" fill="none">
                            <circle cx="50" cy="50" r="40" fill="#fcd34d" />
                            <circle cx="38" cy="45" r="3" fill="#334155" />
                            <circle cx="62" cy="45" r="3" fill="#334155" />
                            <path d="M42 60 Q50 66 58 60" stroke="#334155" strokeWidth="4" strokeLinecap="round" fill="none" />
                            <path d="M22 40 C22 20, 78 20, 78 40" stroke="#ec4899" strokeWidth="10" fill="none" />
                          </svg>
                        </div>
                      </div>
                    </div>

                    {/* Card 2: Connect your apps */}
                    <div 
                      onClick={() => alert("App integrations can be managed via the workspace settings panel.")}
                      className="flex-1 min-w-[200px] max-w-[300px] h-[260px] rounded-2xl border border-[#0284c7]/35 p-5 flex flex-col justify-between cursor-pointer transition-all hover:scale-[1.02] hover:border-white/20 overflow-hidden hover:shadow-[0_16px_36px_rgba(2,132,199,0.4)] shadow-xl"
                      style={{ background: 'linear-gradient(135deg, #0c4a6e, #031e2e)' }}
                    >
                      <div className="flex flex-col text-left">
                        <div className="text-[16px] font-extrabold text-white tracking-tight leading-tight">Connect your apps</div>
                        <div className="text-[11.5px] text-white/55 font-semibold mt-1 leading-snug">Bring your work into Slack</div>
                      </div>
                      
                      {/* Mock Integrations UI inside the card */}
                      <div className="bg-[#131619] border border-white/5 rounded-t-xl p-3 flex flex-col gap-2 w-full mt-4 translate-y-3 shrink-0 shadow-2xl">
                        <div className="flex items-center gap-1 border-b border-white/5 pb-1 w-full justify-between">
                          <div className="flex gap-0.5">
                            <div className="w-1.5 h-1.5 rounded-full bg-red-500" />
                            <div className="w-1.5 h-1.5 rounded-full bg-yellow-500" />
                            <div className="w-1.5 h-1.5 rounded-full bg-green-500" />
                          </div>
                          <span className="text-[8px] text-white/25 select-none font-bold uppercase tracking-wider font-mono">Apps</span>
                        </div>
                        <div className="flex gap-2 justify-center py-3">
                          <div className="w-8 h-8 rounded bg-blue-500/10 border border-blue-500/30 flex items-center justify-center text-xs shadow-sm hover:bg-blue-500/20 transition-colors">☁️</div>
                          <div className="w-8 h-8 rounded bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-xs shadow-sm hover:bg-emerald-500/20 transition-colors">📊</div>
                          <div className="w-8 h-8 rounded bg-purple-500/10 border border-purple-500/30 flex items-center justify-center text-xs shadow-sm hover:bg-purple-500/20 transition-colors">🔐</div>
                          <div className="w-8 h-8 rounded bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-xs shadow-sm hover:bg-amber-500/20 transition-colors">🛠️</div>
                        </div>
                      </div>
                    </div>

                    {/* Card 3: Personalize welcome */}
                    <div 
                      onClick={() => startRecording()}
                      className="flex-1 min-w-[200px] max-w-[300px] h-[260px] rounded-2xl border border-[#059669]/35 p-5 flex flex-col justify-between cursor-pointer transition-all hover:scale-[1.02] hover:border-white/20 overflow-hidden hover:shadow-[0_16px_36px_rgba(5,150,105,0.4)] shadow-xl"
                      style={{ background: 'linear-gradient(135deg, #064e3b, #022c22)' }}
                    >
                      <div className="flex flex-col text-left">
                        <div className="text-[16px] font-extrabold text-white tracking-tight leading-tight">Personalize welcome</div>
                        <div className="text-[11.5px] text-white/55 font-semibold mt-1 leading-snug">Give your audio welcome</div>
                      </div>
                      
                      {/* Waveform Mockup inside the card */}
                      <div className="bg-[#131619] border border-white/5 rounded-t-xl p-3.5 flex flex-col gap-3 w-full mt-4 translate-y-3 shrink-0 shadow-2xl">
                        <div className="flex items-center justify-center gap-1.5 h-10 py-1">
                          <div className="w-0.5 h-3 bg-emerald-400 rounded opacity-60" />
                          <div className="w-0.5 h-5 bg-emerald-400 rounded opacity-80" />
                          <div className="w-0.5 h-8 bg-emerald-400 rounded animate-pulse" />
                          <div className="w-0.5 h-4 bg-emerald-400 rounded opacity-70" />
                          <div className="w-0.5 h-7 bg-emerald-400 rounded animate-pulse" />
                          <div className="w-0.5 h-5 bg-emerald-400 rounded opacity-80" />
                          <div className="w-0.5 h-2 bg-emerald-400 rounded opacity-60" />
                        </div>
                        <div className="flex items-center justify-between border-t border-white/5 pt-1.5 w-full text-[8px] text-white/40 font-bold uppercase tracking-wider font-mono">
                          <span className="flex items-center gap-1 text-[#f43f5e]"><span className="w-1.5 h-1.5 rounded-full bg-[#f43f5e] animate-ping" /> REC</span>
                          <span>0:03</span>
                        </div>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          ) : (
            // DM and Self-Space Welcome block
            <div className="max-w-3xl text-left bg-[#181d22]/50 border border-white/5 rounded-2xl p-8 hover:bg-[#1a2027]/70 transition-colors">
              <h2 className="text-4xl font-black text-white mb-3 tracking-tight flex items-center gap-3">
                {activeChannel === ownerName + ' (you)' && <>📝 This is your space</>}
                {activeChannel && !activeChannel.startsWith('#') && !activeChannel.startsWith('DM:') && activeChannel !== ownerName + ' (you)' && <>💬 Conversation with <span className="text-[#2dd4bf]">{activeChannel}</span></>}
                {activeChannel && activeChannel.startsWith('DM:') && <>💬 Conversation with <span className="text-[#2dd4bf]">{activeChannel.replace('DM: ', '')}</span></>}
              </h2>
              <p className="text-[15.5px] text-white/60 leading-relaxed font-medium">
                {activeChannel === ownerName + ' (you)' && (
                  <>Draft your messages, keep links and files handy 🗂️. And remember, it's perfectly fine to talk to yourself here! 🤖💬</>
                )}
                {activeChannel && !activeChannel.startsWith('#') && !activeChannel.startsWith('DM:') && activeChannel !== ownerName + ' (you)' && (
                  <>This is the beginning of your direct message history with <strong className="text-white/80">{activeChannel}</strong>. Start a private conversation here 🔒.</>
                )}
                {activeChannel && activeChannel.startsWith('DM:') && (
                  <>This is the beginning of your direct message history with <strong className="text-white/80">{activeChannel.replace('DM: ', '')}</strong>. Start a private conversation here 🔒.</>
                )}
              </p>
            </div>
          )}
        </div>

        {/* Messages stream */}
        <div className="flex flex-col gap-4 mt-auto px-8 pb-4">
          {messageTree.map((msg, idx) => {
            const currentDate = new Date(msg.created_at || Date.now()).toDateString();
            const prevDate = idx > 0 ? new Date(messageTree[idx - 1].created_at || Date.now()).toDateString() : null;
            const showSeparator = currentDate !== prevDate;
            
            return (
              <div key={msg.id} className="flex flex-col gap-4">
                {showSeparator && (
                  <div className="flex items-center gap-3 my-2">
                    <span className="flex-1 h-[1px] bg-white/5" />
                    <span className="text-xs text-white/40 border border-white/8 rounded-full px-3 py-1 bg-[#131619] font-medium flex items-center gap-1">
                      {formatDateSeparator(msg.created_at)}
                      <svg className="w-3 h-3 text-white/40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 9l6 6 6-6"/></svg>
                    </span>
                    <span className="flex-1 h-[1px] bg-white/5" />
                  </div>
                )}
                {renderMessageRow(msg, 0)}
              </div>
            );
          })}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Message input box */}
      <div className="p-4 pt-0 shrink-0 bg-[#131619] relative">
        
        {/* Popups */}
        {showEmojiPicker && (
          <div className="emoji-picker-container absolute bottom-[100%] right-10 mb-2 z-50 shadow-2xl">
            <div className="flex justify-end bg-[#222222] p-1"><button onClick={()=>setShowEmojiPicker(false)} className="text-white/50 hover:text-white p-1"><X size={16}/></button></div>
            <EmojiPicker onEmojiClick={onEmojiClick} theme="dark" />
          </div>
        )}
        
        {showGifPicker && (
          <div className="gif-picker-container absolute bottom-[100%] right-20 mb-2 z-50 bg-[#222222] border border-white/10 rounded-xl overflow-hidden shadow-2xl w-[320px] h-[350px] flex flex-col">
            <div className="flex justify-between items-center bg-[#1b1f24] p-3 border-b border-white/5">
              <span className="font-bold text-sm">Select GIF</span>
              <button onClick={()=>setShowGifPicker(false)} className="text-white/50 hover:text-white p-1"><X size={16}/></button>
            </div>
            <div className="flex-1 overflow-y-auto p-2 bg-[#131619]">
              <Grid width={300} columns={2} fetchGifs={fetchGifs} onGifClick={onGifClick} />
            </div>
          </div>
        )}

        {/* Add Link Modal */}
        {showAddLinkModal && (
          <div className="absolute bottom-[100%] left-10 mb-2 z-50 bg-[#222222] border border-white/10 rounded-xl overflow-hidden shadow-2xl w-[320px] p-4 flex flex-col text-left">
            <div className="flex justify-between items-center mb-4 text-white">
              <span className="font-bold text-sm">Add link</span>
              <button onClick={() => setShowAddLinkModal(false)} className="text-white/50 hover:text-white"><X size={16}/></button>
            </div>
            <label className="text-xs font-bold mb-1 text-white">Text</label>
            <input value={linkText} onChange={e=>setLinkText(e.target.value)} className="bg-transparent border border-[#0ea5e9] rounded px-3 py-1.5 mb-3 text-sm focus:outline-none text-white" />
            <label className="text-xs font-bold mb-1 text-white">Link</label>
            <input value={linkUrl} onChange={e=>setLinkUrl(e.target.value)} className="bg-[#131619] border border-white/10 rounded px-3 py-1.5 mb-4 text-sm focus:outline-none text-white" />
            <div className="flex justify-end gap-2">
              <button onClick={()=>setShowAddLinkModal(false)} className="px-3 py-1.5 rounded bg-white/5 hover:bg-white/10 text-sm font-bold text-white">Cancel</button>
              <button onClick={handleSaveLink} className="px-3 py-1.5 rounded bg-[#0d9488] hover:bg-[#0f766e] text-white text-sm font-bold">Save</button>
            </div>
          </div>
        )}

        {/* TipTap Edit Link Bubble Menu */}
        {editor && (
          <BubbleMenu editor={editor} tippyOptions={{ duration: 100 }} shouldShow={({ editor }) => editor.isActive('link')}>
            <div className="bg-[#222222] border border-white/10 rounded-xl shadow-2xl p-3 flex flex-col min-w-[200px] text-left">
              <div className="flex justify-between items-start mb-2">
                <span className="font-bold text-sm text-white/90 truncate max-w-[150px]">{editor.getAttributes('link').href || 'Link'}</span>
                <button onClick={() => editor.chain().focus().unsetLink().run()} className="text-white/50 hover:text-white"><X size={14}/></button>
              </div>
              <a href={editor.getAttributes('link').href} target="_blank" rel="noreferrer" className="text-[#38bdf8] text-xs hover:underline mb-3 truncate block">
                {editor.getAttributes('link').href}
              </a>
              <div className="flex justify-end gap-2">
                <button onClick={handleOpenAddLink} className="px-3 py-1 rounded bg-white/5 hover:bg-white/10 text-white text-xs font-bold transition-colors">Edit</button>
                <button onClick={() => editor.chain().focus().unsetLink().run()} className="px-3 py-1 rounded bg-[#be123c] hover:bg-[#9f1239] text-white text-xs font-bold transition-colors">Remove</button>
              </div>
            </div>
          </BubbleMenu>
        )}

        <div className="bg-[#1b1f24] border border-white/10 rounded-xl flex flex-col focus-within:border-white/20 focus-within:shadow-[0_0_15px_rgba(45,212,191,0.1)] transition-all">
          {replyingToMessage && (
            <div className="flex items-center justify-between px-4 py-2 border-b border-white/5 bg-white/[0.02] text-xs rounded-t-xl">
              <div className="flex items-center gap-2 min-w-0">
                <span className="font-bold text-[#38bdf8]">Replying to {replyingToMessage.sender}</span>
                <span className="text-white/40 truncate text-[11px] block" dangerouslySetInnerHTML={{ __html: replyingToMessage.text }} />
              </div>
              <button onClick={() => setReplyingToMessage(null)} className="text-white/40 hover:text-white transition-colors p-1 cursor-pointer shrink-0">
                <X size={14} />
              </button>
            </div>
          )}
          
          {/* Formatting toolbar */}
          <div className="flex items-center gap-1.5 px-3 py-2 border-b border-white/5 text-white/40">
            <button 
              onClick={() => editor?.chain().focus().toggleBold().run()} 
              className={`p-1 hover:text-white hover:bg-white/5 rounded transition-colors cursor-pointer ${editor?.isActive('bold') ? 'bg-white/10 text-white' : ''}`}
            >
              <Bold size={16} />
            </button>
            <button 
              onClick={() => editor?.chain().focus().toggleItalic().run()} 
              className={`p-1 hover:text-white hover:bg-white/5 rounded transition-colors cursor-pointer ${editor?.isActive('italic') ? 'bg-white/10 text-white' : ''}`}
            >
              <Italic size={16} />
            </button>
            <button 
              onClick={() => editor?.chain().focus().toggleUnderline().run()} 
              className={`p-1 hover:text-white hover:bg-white/5 rounded transition-colors cursor-pointer ${editor?.isActive('underline') ? 'bg-white/10 text-white' : ''}`}
            >
              <UnderlineIcon size={16} />
            </button>
            <button 
              onClick={() => editor?.chain().focus().toggleStrike().run()} 
              className={`p-1 hover:text-white hover:bg-white/5 rounded transition-colors cursor-pointer ${editor?.isActive('strike') ? 'bg-white/10 text-white' : ''}`}
            >
              <Strikethrough size={16} />
            </button>
            <span className="w-[1px] h-4 bg-white/10 mx-1" />
            <button 
              onClick={handleOpenAddLink}
              className={`p-1 hover:text-white hover:bg-white/5 rounded transition-colors cursor-pointer ${editor?.isActive('link') ? 'bg-white/10 text-white' : ''}`}
            >
              <LinkIcon size={16} />
            </button>
            <button 
              onClick={() => editor?.chain().focus().toggleCode().run()}
              className={`p-1 hover:text-white hover:bg-white/5 rounded transition-colors cursor-pointer ${editor?.isActive('code') ? 'bg-white/10 text-white' : ''}`}
              title="Inline Code"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="8 6 2 12 8 18"></polyline>
                <line x1="13.5" y1="4.5" x2="10.5" y2="19.5"></line>
                <polyline points="16 18 22 12 16 6"></polyline>
              </svg>
            </button>
            <button 
              onClick={() => editor?.chain().focus().toggleCodeBlock().run()}
              className={`p-1 hover:text-white hover:bg-white/5 rounded transition-colors cursor-pointer ${editor?.isActive('codeBlock') ? 'bg-white/10 text-white' : ''}`}
              title="Code Block"
            >
               <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                 <polyline points="5 5 2 8 5 11"></polyline>
                 <line x1="9" y1="3.5" x2="7" y2="12.5"></line>
                 <polyline points="11 11 14 8 11 5"></polyline>
                 <path d="M9 15v6h12V9h-6"></path>
               </svg>
            </button>
          </div>

          {/* Audio Preview (Inside text box) */}
          {recordedAudioUrl && (
            <div className="px-3 pt-3 flex items-center group relative">
              <div className="absolute -top-7 opacity-0 group-hover:opacity-100 transition-opacity bg-[#222] text-xs font-bold text-white px-2 py-1 rounded shadow-lg pointer-events-none whitespace-nowrap z-50">
                Remove audio clip
                <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-[#222] rotate-45"></div>
              </div>
              <div className="flex items-center gap-3 bg-[#131619] rounded-lg border border-white/5 py-1.5 px-3 shadow-inner">
                <button onClick={() => new Audio(recordedAudioUrl).play()} className="w-7 h-7 rounded-full bg-[#38bdf8] text-white flex items-center justify-center shadow-md hover:bg-[#0ea5e9] transition-colors cursor-pointer">
                   <Play size={14} fill="currentColor" />
                </button>
                <div className="text-[#38bdf8] text-xs font-bold tracking-widest">||||||||||||</div>
                <span className="text-white/50 text-xs font-bold font-mono">0:{recordingTime.toString().padStart(2, '0')}</span>
                <button onClick={clearAudioPreview} className="w-5 h-5 rounded-full hover:bg-white/10 flex items-center justify-center text-white/50 hover:text-white ml-2 transition-colors cursor-pointer">
                  <X size={12}/>
                </button>
              </div>
            </div>
          )}

          {/* TipTap Editor Area */}
          <div className="w-full text-white text-[14px] p-3.5 leading-relaxed text-left">
            <EditorContent 
              editor={editor} 
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  handleSendWrapper()
                }
              }} 
            />
          </div>

          {/* Bottom action row */}
          <div className="flex items-center justify-between px-3 py-2 border-t border-white/5">
            <div className="flex items-center gap-2 text-white/50 relative">
              <input 
                type="file" 
                ref={fileInputRef} 
                onChange={handleFileUpload} 
                className="hidden" 
                accept="application/pdf,audio/*"
              />
              <button onClick={() => fileInputRef.current?.click()} className="w-6 h-6 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center text-sm hover:text-white transition-colors cursor-pointer" title="Attach PDF or Audio">+</button>
              <button className="p-1 hover:text-white transition-colors font-semibold text-base cursor-pointer">Aa</button>
              <button onClick={() => {setShowEmojiPicker(!showEmojiPicker); setShowGifPicker(false);}} className="emoji-picker-trigger p-1 hover:text-white transition-colors text-base cursor-pointer" title="Emojis">😊</button>
              <button onClick={() => {setShowGifPicker(!showGifPicker); setShowEmojiPicker(false);}} className="gif-picker-trigger p-1 hover:text-white transition-colors text-base cursor-pointer" title="GIFs">🖼️</button>
              <button onClick={() => editor?.chain().focus().insertContent('@').run()} className="p-1 hover:text-white transition-colors font-bold text-base cursor-pointer">@</button>
              <button className="p-1 hover:text-white transition-colors text-base cursor-pointer">📹</button>
              
              {/* Mic Icon / Recording Tick Box */}
              {isRecording ? (
                <div className="relative">
                  <div className="absolute bottom-full mb-3 left-1/2 -translate-x-1/2 bg-[#222222] border border-white/10 rounded-lg p-2 px-3 flex items-center gap-3 shadow-xl z-50 whitespace-nowrap">
                    <span className="text-white text-xs font-semibold">Stop recording</span>
                    <div className="flex items-center gap-2">
                       <div className="text-[#38bdf8] text-xs font-bold tracking-widest animate-pulse">||||||</div>
                       <span className="text-white text-xs font-bold font-mono">0:{recordingTime.toString().padStart(2, '0')}</span>
                    </div>
                    <button onClick={cancelRecording} className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-[#1b1f24] border border-white/10 hover:bg-white/10 flex items-center justify-center text-white shadow-lg cursor-pointer"><X size={12}/></button>
                  </div>
                  <button onClick={stopRecording} className="w-6 h-6 bg-[#38bdf8] hover:bg-[#0ea5e9] rounded flex items-center justify-center text-white shadow-[0_0_10px_rgba(56,189,248,0.4)] transition-all cursor-pointer">
                    <Check size={16} strokeWidth={3}/>
                  </button>
                </div>
              ) : (
                <button onClick={startRecording} className="p-1 hover:text-white transition-colors text-base cursor-pointer" title="Record Audio">🎙</button>
              )}
              
              <button className="p-1 hover:text-white transition-colors text-base cursor-pointer">/</button>
            </div>
            
            <div className="flex items-center overflow-visible rounded-md bg-[#0d9488] text-white relative">
              <button
                onClick={() => handleSendWrapper()}
                disabled={isUploading || isRecording || (newMessageText === '<p></p>' && !recordedAudioBlob)}
                className="px-4 py-1.5 hover:bg-white/10 transition-colors cursor-pointer font-bold text-[13px] disabled:opacity-50 border-r border-white/20"
              >
                {isUploading ? 'Sending...' : 'Send'}
              </button>
              <button 
                onClick={() => setShowScheduleMenu(!showScheduleMenu)}
                className="schedule-menu-trigger px-2 py-1.5 hover:bg-white/10 transition-colors cursor-pointer disabled:opacity-50 h-full flex items-center justify-center"
                disabled={isUploading || isRecording || (newMessageText === '<p></p>' && !recordedAudioBlob)}
              >
                <ChevronDown size={16} />
              </button>
              
              {showScheduleMenu && (
                <div className="schedule-menu-container absolute bottom-[110%] right-0 mb-1 w-56 bg-[#222222] border border-white/10 rounded-lg shadow-2xl py-1 z-50 text-left">
                  <div className="px-3 py-1.5 text-[11px] font-bold text-white/50 border-b border-white/5 uppercase tracking-wide">Schedule message</div>
                  <button className="w-full text-left px-3 py-2 text-sm text-white hover:bg-white/10 transition-colors">Tomorrow at 9:00 AM</button>
                  <button className="w-full text-left px-3 py-2 text-sm text-white hover:bg-white/10 transition-colors">Monday at 9:00 AM</button>
                  <div className="h-[1px] bg-white/5 my-1"></div>
                  <button 
                    onClick={() => {
                      setShowScheduleMenu(false)
                      setShowCustomTimeModal(true)
                    }} 
                    className="w-full text-left px-3 py-2 text-sm text-white hover:bg-white/10 transition-colors"
                  >
                    Custom time
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Custom Time Modal */}
      {showCustomTimeModal && (
        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm z-[200] flex items-center justify-center p-4 animate-fade-in text-left">
          <div className="bg-[#1a1d21] border border-white/10 rounded-xl w-[380px] shadow-2xl overflow-hidden flex flex-col">
            <div className="p-5 flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <h2 className="text-[17px] font-extrabold text-white tracking-tight">Schedule message</h2>
                <button onClick={() => setShowCustomTimeModal(false)} className="text-white/40 hover:text-white transition-colors cursor-pointer p-1">
                  <X size={18} />
                </button>
              </div>
              <p className="text-[13px] text-white/60 mb-2">Time zone: Chennai, Kolkata, Mumbai, New Delhi</p>
              
              <div className="flex gap-3">
                <div className="relative flex-1">
                  <select 
                    value={customDate}
                    onChange={(e) => setCustomDate(e.target.value)}
                    className="w-full bg-transparent border border-white/20 rounded-lg p-2.5 pl-9 text-[14px] text-white appearance-none focus:outline-none focus:border-[#0d9488] transition-colors cursor-pointer"
                  >
                    <option value="Today" className="bg-[#1b1f24]">Today</option>
                    <option value="Tomorrow" className="bg-[#1b1f24]">Tomorrow</option>
                    <option value="Monday" className="bg-[#1b1f24]">Monday</option>
                    <option value="Custom" className="bg-[#1b1f24]">Custom date...</option>
                  </select>
                  <Calendar size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40 pointer-events-none" />
                  <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 pointer-events-none" />
                </div>
                
                <div className="relative flex-1">
                  <select 
                    value={customTime}
                    onChange={(e) => setCustomTime(e.target.value)}
                    className="w-full bg-transparent border border-white/20 rounded-lg p-2.5 pl-9 text-[14px] text-white appearance-none focus:outline-none focus:border-[#0d9488] transition-colors cursor-pointer"
                  >
                    <option value="09:00" className="bg-[#1b1f24]">9:00 AM</option>
                    <option value="12:00" className="bg-[#1b1f24]">12:00 PM</option>
                    <option value="16:00" className="bg-[#1b1f24]">4:00 PM</option>
                    <option value="18:00" className="bg-[#1b1f24]">6:00 PM</option>
                    <option value="Custom" className="bg-[#1b1f24]">Custom time...</option>
                  </select>
                  <Clock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40 pointer-events-none" />
                  <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 pointer-events-none" />
                </div>
              </div>
              
              <div className="flex justify-end gap-3 mt-4">
                <button 
                  onClick={() => setShowCustomTimeModal(false)}
                  className="px-4 py-2 rounded-lg border border-white/10 hover:bg-white/5 text-[14px] font-bold text-white transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button 
                  onClick={() => {
                    alert(`Message scheduled successfully for ${customDate} at ${customTime}`);
                    setShowCustomTimeModal(false);
                    setNewMessageText('');
                  }}
                  className="px-4 py-2 rounded-lg bg-[#0d9488] hover:bg-[#0f766e] text-[14px] font-bold text-white transition-colors shadow-lg shadow-teal-500/20 cursor-pointer"
                >
                  Schedule Message
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* WhatsApp-Style Reactions Modal */}
      {showReactionsModalMsg && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[200] flex items-center justify-center p-4 animate-fade-in text-left">
          <div className="bg-[#1a1d21] border border-white/10 rounded-xl w-[360px] shadow-2xl overflow-hidden flex flex-col max-h-[60vh]">
            <div className="p-4 border-b border-white/5 flex items-center justify-between text-white">
              <h3 className="font-extrabold text-[15px]">Reactions</h3>
              <button onClick={() => setShowReactionsModalMsg(null)} className="text-white/40 hover:text-white transition-colors cursor-pointer p-1">
                <X size={16} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
              {showReactionsModalMsg.reactions.map((react, i) => (
                <div key={i} className="flex items-center justify-between bg-white/[0.02] border border-white/5 rounded-lg p-2.5">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded bg-[#d81b60] text-white font-bold text-xs flex items-center justify-center">
                      {react.sender_name ? react.sender_name[0].toUpperCase() : '?'}
                    </div>
                    <span className="text-[13px] font-semibold text-white">{react.sender_name}</span>
                  </div>
                  <span className="text-lg">{react.emoji}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
