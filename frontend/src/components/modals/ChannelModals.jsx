import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import api from '../../api';

export function ChannelCreationWizard({ onClose, onCreated }) {
  const [step, setStep] = useState(1);
  const [name, setName] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleNext = () => {
    if (name.trim()) setStep(2);
  }

  const handleCreate = async () => {
    setLoading(true);
    try {
      const res = await api.post('/projects/', { name: name.trim(), description: '', is_private: isPrivate })
      onCreated(res.data)
      onClose()
    } catch(err) {
      alert("Failed to create channel")
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-[#1e1e1e] border border-white/10 rounded-2xl p-6 w-full max-w-md shadow-2xl animate-fade-in-up">
        {step === 1 ? (
          <>
            <h2 className="text-xl font-bold text-white mb-1">Create a channel</h2>
            <p className="text-text-secondary text-sm mb-6">Channels are where your team communicates. They're best when organized around a topic — #marketing, for example.</p>
            <div className="mb-6">
              <label className="block text-sm font-semibold text-white mb-2">Name</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40">#</span>
                <input 
                  type="text" 
                  value={name}
                  onChange={(e) => setName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))}
                  placeholder="e.g. plan-budget"
                  className="w-full bg-white/5 border border-white/10 rounded-lg pl-8 pr-4 py-2.5 text-white focus:outline-none focus:border-brand-accent transition-colors"
                  autoFocus
                />
              </div>
            </div>
            <div className="flex justify-end gap-3">
              <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-text-secondary hover:text-white transition-colors cursor-pointer">Cancel</button>
              <button 
                onClick={handleNext} 
                disabled={!name.trim()}
                className="px-4 py-2 text-sm font-semibold text-white bg-brand-accent hover:bg-brand-accent/90 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg shadow-[0_0_15px_var(--color-brand-accent-glow)] transition-all cursor-pointer"
              >
                Next
              </button>
            </div>
          </>
        ) : (
          <>
            <h2 className="text-xl font-bold text-white mb-1">Visibility</h2>
            <p className="text-text-secondary text-sm mb-6">Choose who can view and join this channel.</p>
            <div className="flex flex-col gap-3 mb-8">
              <label className={`flex items-start gap-3 p-4 rounded-xl border cursor-pointer transition-colors ${!isPrivate ? 'border-brand-accent bg-brand-accent/10' : 'border-white/10 bg-white/5 hover:bg-white/10'}`}>
                <input type="radio" checked={!isPrivate} onChange={() => setIsPrivate(false)} className="mt-1 accent-brand-accent" />
                <div>
                  <div className="font-semibold text-white text-sm">Public — anyone in workspace</div>
                  <div className="text-xs text-text-secondary mt-1">Best for topics that everyone should have access to.</div>
                </div>
              </label>
              <label className={`flex items-start gap-3 p-4 rounded-xl border cursor-pointer transition-colors ${isPrivate ? 'border-brand-accent bg-brand-accent/10' : 'border-white/10 bg-white/5 hover:bg-white/10'}`}>
                <input type="radio" checked={isPrivate} onChange={() => setIsPrivate(true)} className="mt-1 accent-brand-accent" />
                <div>
                  <div className="font-semibold text-white text-sm">Private — only specific people</div>
                  <div className="text-xs text-text-secondary mt-1">Best for highly confidential or restricted topics.</div>
                </div>
              </label>
            </div>
            <div className="flex justify-between items-center">
              <button onClick={() => setStep(1)} className="px-4 py-2 text-sm font-medium text-text-secondary hover:text-white transition-colors cursor-pointer">Back</button>
              <button 
                onClick={handleCreate} 
                disabled={loading}
                className="px-5 py-2 text-sm font-semibold text-white bg-brand-accent hover:bg-brand-accent/90 disabled:opacity-50 rounded-lg shadow-[0_0_15px_var(--color-brand-accent-glow)] transition-all cursor-pointer"
              >
                {loading ? 'Creating...' : 'Create'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export function PrivateChannelMembersModal({ projectId, onClose }) {
  const [members, setMembers] = useState([])
  const [workspaceUsers, setWorkspaceUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const { tenantId } = useParams()

  const fetchMembers = async () => {
    try {
      const [membersRes, usersRes] = await Promise.all([
        api.get(`/projects/${projectId}/members`),
        api.get('/users/')
      ])
      setMembers(membersRes.data)
      setWorkspaceUsers(usersRes.data)
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchMembers()
  }, [projectId])

  const handleAddMember = async (accountId) => {
    try {
      await api.post(`/projects/${projectId}/members`, { account_id: accountId })
      fetchMembers()
    } catch (err) {
      alert(err.response?.data?.detail || "Failed to add member")
    }
  }

  const handleUpdateRole = async (accountId, role) => {
    try {
      await api.patch(`/projects/${projectId}/members/${accountId}/role`, { role })
      fetchMembers()
    } catch (err) {
      alert(err.response?.data?.detail || "Failed to update role")
    }
  }

  const handleKick = async (accountId) => {
    try {
      await api.delete(`/projects/${projectId}/members/${accountId}`)
      fetchMembers()
    } catch (err) {
      alert(err.response?.data?.detail || "Failed to remove member")
    }
  }

  const notInChannel = workspaceUsers.filter(u => !members.some(m => m.account_id === u.account_id))

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-[#1e1e1e] border border-white/10 rounded-2xl w-full max-w-2xl h-[600px] flex flex-col shadow-2xl animate-fade-in-up">
        <div className="flex items-center justify-between p-6 border-b border-white/10 shrink-0">
          <h2 className="text-xl font-bold text-white tracking-tight">Manage Members</h2>
          <button onClick={onClose} className="text-white/50 hover:text-white transition-colors cursor-pointer text-xl">&times;</button>
        </div>
        
        <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-8">
          {loading ? <div className="text-white/50">Loading...</div> : (
            <>
              {/* Existing Members */}
              <div>
                <h3 className="text-sm font-semibold text-white/70 mb-4 uppercase tracking-wider">In Channel</h3>
                <div className="flex flex-col gap-2">
                  {members.map(m => (
                    <div key={m.account_id} className="flex items-center justify-between p-3 rounded-xl bg-white/5 border border-white/5">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-brand-accent/20 text-brand-accent-2 flex items-center justify-center font-bold text-sm">
                          {m.name?.[0]?.toUpperCase() || '?'}
                        </div>
                        <div>
                          <div className="text-sm font-semibold text-white">{m.name}</div>
                          <div className="text-xs text-text-secondary">{m.email}</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <select 
                          className="bg-black/20 text-xs text-white border border-white/10 rounded-md px-2 py-1 outline-none cursor-pointer"
                          value={m.role}
                          onChange={(e) => handleUpdateRole(m.account_id, e.target.value)}
                        >
                          <option value="Admin">Admin</option>
                          <option value="Elder">Elder</option>
                          <option value="Member">Member</option>
                        </select>
                        <button 
                          onClick={() => handleKick(m.account_id)}
                          className="text-xs text-red-400 hover:text-red-300 px-2 py-1 rounded bg-red-400/10 hover:bg-red-400/20 transition-colors cursor-pointer"
                        >
                          Kick
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Not in Channel */}
              <div>
                <h3 className="text-sm font-semibold text-white/70 mb-4 uppercase tracking-wider">Add to Channel</h3>
                <div className="flex flex-col gap-2">
                  {notInChannel.length === 0 ? (
                    <div className="text-sm text-white/40 italic">All workspace members are already in this channel.</div>
                  ) : (
                    notInChannel.map(u => (
                      <div key={u.account_id} className="flex items-center justify-between p-3 rounded-xl hover:bg-white/5 border border-transparent hover:border-white/5 transition-colors">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-white/10 text-white/50 flex items-center justify-center font-bold text-sm">
                            {u.account.name?.[0]?.toUpperCase() || '?'}
                          </div>
                          <div>
                            <div className="text-sm font-semibold text-white">{u.account.name}</div>
                            <div className="text-xs text-text-secondary">{u.account.email}</div>
                          </div>
                        </div>
                        <button 
                          onClick={() => handleAddMember(u.account_id)}
                          className="text-xs font-semibold text-white bg-brand-accent hover:bg-brand-accent/90 px-3 py-1.5 rounded-lg shadow-[0_0_10px_var(--color-brand-accent-glow)] transition-all cursor-pointer"
                        >
                          Add
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

