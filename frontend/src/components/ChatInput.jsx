import { useState, useRef } from 'react'
import API from '../config'

export default function ChatInput({ onSend, connected, typing, onStop, autoMode, onToggleAuto, onPersistent, persistentMode, activeAgent, activeSession, onFileUploaded, directMode, onToggleDirect }) {
  const [text, setText] = useState('')
  const taRef = useRef(null)
  const fileInputRef = useRef(null)

  const handleChange = (e) => {
    setText(e.target.value)
    const el = taRef.current
    if (el) {
      el.style.height = 'auto'
      el.style.height = Math.min(el.scrollHeight, 200) + 'px'
    }
  }

  const handleSend = () => {
    if (!text.trim() || !connected) return
    onSend(text.trim())
    setText('')
    if (taRef.current) {
      taRef.current.style.height = 'auto'
    }
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleFile = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    const form = new FormData()
    form.append('file', file)
    try {
      const r = await fetch(`${API}/api/agents/${activeAgent}/upload`, { method: 'POST', body: form })
      if (r.ok) {
        const d = await r.json()
        if (onFileUploaded) onFileUploaded(d.filename)
      }
    } catch (_) {}
    e.target.value = ''
  }

  const handleToggleAuto = () => {
    if (autoMode) {
      onToggleAuto('')
    } else {
      const prompt = text.trim() || 'συνέχισε'
      onToggleAuto(prompt)
    }
  }

  const handlePersistent = () => {
    const prompt = text.trim() || 'συνέχισε μέχρι να ολοκληρωθεί'
    onPersistent(prompt)
  }

  return (
    <div className="flex gap-2 max-w-4xl mx-auto items-end">
      <div className="flex-1 flex gap-2 items-end bg-app-elevated/80 border border-app-elevated rounded-2xl px-4 py-2 focus-within:border-accent/60 focus-within:shadow-[0_0_0_3px_var(--accent-glow)] transition-all">
        <textarea ref={taRef} value={text} onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder={connected ? 'Μήνυμα...' : 'Connecting...'}
          disabled={!connected}
          rows={1}
          className="flex-1 resize-none bg-transparent text-sm text-text-primary placeholder-text-dim/50 focus:outline-none disabled:opacity-40 leading-relaxed max-h-[200px]"
          style={{ minHeight: '24px' }}
        />
        <button onClick={() => fileInputRef.current?.click()}
          className="text-text-dim/60 hover:text-accent transition-colors text-sm shrink-0" title="Upload file">📎</button>
        <input ref={fileInputRef} type="file" className="hidden" onChange={handleFile} />
      </div>
      {typing && (
        <button onClick={onStop} className="bg-error/10 hover:bg-error/20 text-error rounded-full px-4 py-2 font-medium transition-all flex items-center gap-1.5 text-sm border border-error/20 shrink-0"><span>■</span></button>
      )}
      <button onClick={handleToggleAuto}
        className={`text-[10px] px-2.5 py-2 rounded-full font-bold transition-all shrink-0 ${autoMode ? 'bg-green-500/20 text-green-400 border border-green-500/40 animate-pulse' : 'bg-app-elevated text-gray-400 hover:text-gray-300 border border-app-elevated'}`}
        title={autoMode ? 'Stop auto mode' : 'Αυτόνομη συνέχεια'}>
        {autoMode ? '■' : '♾️'}
      </button>
      <button onClick={handlePersistent}
        className={`text-[10px] px-2.5 py-2 rounded-full font-bold transition-all shrink-0 ${persistentMode ? 'bg-purple-500/30 text-purple-300 border border-purple-500/60 animate-pulse' : 'bg-purple-500/20 text-purple-400 border border-purple-500/40 hover:bg-purple-500/30'}`}
        title={persistentMode ? 'Persistent active — click to send another' : 'Persistent mode'}>
        {persistentMode ? '⏳' : '🔁'}
      </button>
      {activeAgent === 'ceo' && (
        <button onClick={onToggleDirect}
          className={`text-[9px] px-1.5 py-1 rounded font-bold transition-all shrink-0 ${directMode ? 'bg-blue-500/20 text-blue-400 border border-blue-500/40' : 'bg-app-elevated text-gray-500 hover:text-gray-400 border border-app-elevated'}`}
          title={directMode ? 'Direct: μήνυμα μόνο σε CEO χωρίς agent plan' : 'Agent plan: θα επιλέξεις ποιοι agents θα συμμετέχουν'}>
          {directMode ? '⚡' : '👥'}
        </button>
      )}
      <button onClick={handleSend} disabled={!connected || !text.trim()}
        className="bg-accent hover:bg-accent-dim disabled:bg-app-elevated text-white rounded-full px-5 py-2.5 font-medium transition-all disabled:text-text-dim shrink-0 text-sm">
        Send →
      </button>
    </div>
  )
}
