import { useState, useEffect } from 'react'
import API from '../config'

export default function SettingsPanel({ onClose }) {
  const [engines, setEngines] = useState([])
  const [statuses, setStatuses] = useState({})
  const [keys, setKeys] = useState([])
  const [perf, setPerf] = useState(null)
  const [editingKey, setEditingKey] = useState(null)
  const [newKeyValue, setNewKeyValue] = useState('')
  const [saveStatus, setSaveStatus] = useState(null)
  const [tunnel, setTunnel] = useState({ active: false, url: null, error: null, method: null, token_configured: false })
  const [tunnelLoading, setTunnelLoading] = useState(false)

  const fetchAll = () => {
    fetch(`${API}/api/engines`).then(r=>r.json()).then(d => {
      setEngines(d.engines||[])
      const s = {}
      d.engines?.forEach(e => { s[e.id] = e.status })
      setStatuses(s)
    }).catch(()=>{})
    fetch(`${API}/api/keys`).then(r=>r.json()).then(d => {
      const raw = d.keys||{}
      setKeys(Object.entries(raw).map(([id, val]) => ({
        id,
        masked: typeof val === 'string' ? val.substring(0, 8)+'...'+val.slice(-4) : String(val)
      })))
    }).catch(()=>{})
    fetch(`${API}/api/engine-perf`).then(r=>r.json()).then(d => {
      setPerf(d)
    }).catch(()=>{})
    fetch(`${API}/api/tunnel/status`).then(r=>r.json()).then(d => {
      setTunnel(d)
    }).catch(()=>{})
  }

  useEffect(() => { fetchAll() }, [])

  const updateKey = async (engineId) => {
    if (!newKeyValue.trim()) return
    setSaveStatus('saving')
    try {
      const r = await fetch(`${API}/api/keys`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({engine_id: engineId, api_key: newKeyValue})
      })
      if (r.ok) {
        setSaveStatus('saved')
        setEditingKey(null)
        setNewKeyValue('')
        fetchAll()
        setTimeout(() => setSaveStatus(null), 2000)
      } else {
        setSaveStatus('error')
      }
    } catch {
      setSaveStatus('error')
    }
  }

  const toggleTunnel = async () => {
    setTunnelLoading(true)
    try {
      const ep = tunnel.active ? `${API}/api/tunnel/stop` : `${API}/api/tunnel/start`
      const r = await fetch(ep, { method: 'POST' })
      const d = await r.json()
      setTunnel(d)
    } catch {}
    setTunnelLoading(false)
  }

  return (
    <div className="p-3 overflow-y-auto h-full text-xs flex flex-col gap-2">
      <div className="flex items-center justify-between mb-2">
        <span className="text-gray-500 uppercase font-medium">Settings</span>
        <div className="flex items-center gap-2">
          {saveStatus === 'saved' && <span className="text-green-400 text-[9px]">✓ saved</span>}
          {saveStatus === 'error' && <span className="text-red-400 text-[9px]">✕ error</span>}
          <button onClick={fetchAll} className="text-gray-500 hover:text-violet-400 transition-colors text-[10px]">↻</button>
          <button onClick={onClose} className="text-gray-500 hover:text-violet-400 transition-colors text-[10px]">✕</button>
        </div>
      </div>

      <div className="text-gray-500 uppercase font-medium text-[10px] mt-2 mb-1">Engines</div>
      {engines.map(e =>
        <div key={e.id} className="flex items-center justify-between bg-gray-800/60 rounded p-2">
          <div className="flex-1 min-w-0">
            <div className="text-gray-200 font-medium flex items-center gap-1">
              {e.name}
              <span className="text-[8px] font-mono">{e.speed_rating}</span>
              <span className="text-[8px] text-gray-600 font-mono">⚡{e.capability}</span>
            </div>
            <div className="text-gray-500 text-[9px]">#{e.priority} {e.model}</div>
            {perf?.stats?.[e.id]?.calls > 0 && (
              <div className="text-gray-600 text-[8px] mt-0.5">
                {perf.stats[e.id].calls} calls · avg {perf.stats[e.id].avg_time}s · {perf.stats[e.id].success_rate}% success
              </div>
            )}
            {e.rate_limit && (
              <div className="text-[8px] mt-0.5">
                {e.rate_limit.calls_in_window}/{e.rate_limit.max_calls} RPM
              </div>
            )}
          </div>
          <div className="flex items-center text-[9px]">{e.status}</div>
        </div>
      )}

      <div className="text-gray-500 uppercase font-medium text-[10px] mt-2 mb-1">Engine Performance</div>
      {perf?.stats && Object.entries(perf.stats).sort((a,b) => (b[1].success_rate||0) - (a[1].success_rate||0)).map(([id, s]) => (
        <div key={id} className="flex items-center justify-between bg-gray-800/40 rounded p-1.5">
          <span className="text-gray-300 text-[10px]">{id}</span>
          <div className="flex gap-2 text-[9px] text-gray-500">
            <span>{s.calls} calls</span>
            <span>{s.avg_time}s</span>
            <span className={s.success_rate >= 90 ? 'text-green-400' : s.success_rate >= 70 ? 'text-yellow-400' : 'text-red-400'}>
              {s.success_rate}%
            </span>
            <span className="text-gray-700">{s.last_used?.slice(11,19)||''}</span>
          </div>
        </div>
      ))}
      {(!perf?.stats || Object.keys(perf.stats).length === 0) && (
        <div className="text-gray-600 text-[9px] italic">No performance data yet</div>
      )}

      <div className="text-gray-500 uppercase font-medium text-[10px] mt-2 mb-1">API Keys</div>
      {engines.map(eng => {
        const k = keys.find(x => x.id === eng.id)
        const isEditing = editingKey === eng.id
        return (
          <div key={eng.id} className="bg-gray-800/40 rounded p-1.5">
            <div className="flex items-center justify-between">
              <span className="text-gray-300">{eng.id}</span>
              <div className="flex items-center gap-2">
                <span className="text-gray-600 font-mono text-[9px]">{k?.masked || 'not set'}</span>
                <button onClick={() => { setEditingKey(isEditing ? null : eng.id); setNewKeyValue('') }}
                  className="text-gray-500 hover:text-accent transition-colors text-[9px]">{isEditing ? '✕' : '✎'}</button>
              </div>
            </div>
            {isEditing && (
              <div className="flex gap-1 mt-1.5">
                <input value={newKeyValue} onChange={ev => setNewKeyValue(ev.target.value)}
                  placeholder="Paste new API key..."
                  className="flex-1 bg-gray-900 border border-gray-700 rounded px-2 py-1 text-[10px] text-gray-300 focus:outline-none focus:border-accent placeholder:text-gray-600 font-mono"
                  onKeyDown={ev => { if (ev.key === 'Enter') updateKey(eng.id) }} />
                <button onClick={() => updateKey(eng.id)}
                  className="text-[9px] px-2 py-1 bg-accent/20 text-accent rounded hover:bg-accent/30 transition-colors">Save</button>
              </div>
            )}
          </div>
        )
      })}
      <div className="text-gray-500 uppercase font-medium text-[10px] mt-2 mb-1">Remote Access</div>
      <div className="bg-gray-800/40 rounded p-2">
        <div className="flex items-center justify-between">
          <div className="flex-1 min-w-0">
            {tunnel.active ? (
              <div>
                <div className="text-green-400 font-medium flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-400 inline-block animate-pulse" />
                  Active
                </div>
                <a href={tunnel.url} target="_blank" rel="noopener noreferrer"
                  className="text-accent hover:underline text-[10px] font-mono break-all">{tunnel.url}</a>
                <div className="text-gray-600 text-[8px] mt-0.5">via {tunnel.method}</div>
              </div>
            ) : tunnel.error ? (
              <div>
                <div className="text-yellow-400 text-[10px]">{tunnel.error}</div>
                {!tunnel.token_configured && (
                  <div className="text-gray-600 text-[8px] mt-1">
                    Get a free token at <span className="text-accent">ngrok.com</span> and add to ~/AION/.env:
                    <code className="block bg-gray-900 rounded px-1 py-0.5 mt-0.5 text-[8px]">export NGROK_AUTH_TOKEN=your_token</code>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-gray-500 text-[10px]">Not connected</div>
            )}
          </div>
          <button onClick={toggleTunnel} disabled={tunnelLoading}
            className={`text-[10px] px-2.5 py-1 rounded transition-colors whitespace-nowrap ${
              tunnel.active
                ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30'
                : 'bg-accent/20 text-accent hover:bg-accent/30'
            } ${tunnelLoading ? 'opacity-50' : ''}`}>
            {tunnelLoading ? '...' : tunnel.active ? 'Stop' : 'Start'}
          </button>
        </div>
      </div>
    </div>
  )
}
