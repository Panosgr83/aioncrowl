import { useState, useEffect } from 'react'
import API from '../config'

export default function SettingsPanel({ onClose }) {
  const [engines, setEngines] = useState([])
  const [statuses, setStatuses] = useState({})
  const [keys, setKeys] = useState([])

  useEffect(() => {
    fetch(`${API}/api/engines`).then(r=>r.json()).then(d => {
      setEngines(d.engines||[])
      const s = {}
      d.engines?.forEach(e => { s[e.id] = e.status })
      setStatuses(s)
    }).catch(()=>{})
    fetch(`${API}/api/keys`).then(r=>r.json()).then(d => setKeys(d.keys||[])).catch(()=>{})
  }, [])

  return (
    <div className="p-3 overflow-y-auto h-full text-xs flex flex-col gap-2">
      <div className="flex items-center justify-between mb-2">
        <span className="text-gray-500 uppercase font-medium">Settings</span>
        <button onClick={onClose} className="text-gray-500 hover:text-violet-400 transition-colors text-[10px]">✕</button>
      </div>
      <div className="text-gray-500 uppercase font-medium text-[10px] mt-2 mb-1">Engines</div>
      {engines.map(e => (
        <div key={e.id} className="flex items-center justify-between bg-gray-800/60 rounded p-2">
          <div>
            <div className="text-gray-200 font-medium">{e.name}</div>
            <div className="text-gray-500 text-[9px]">{e.model} · {e.max_tokens} tokens</div>
          </div>
          <div className={`flex items-center gap-1 text-[9px] ${e.status === 'active' ? 'text-green-400' : 'text-red-400'}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${e.status === 'active' ? 'bg-green-400' : 'bg-red-400'}`} />
            {e.status}
          </div>
        </div>
      ))}
      <div className="text-gray-500 uppercase font-medium text-[10px] mt-2 mb-1">API Keys</div>
      {keys.map(k => (
        <div key={k.id} className="flex items-center justify-between bg-gray-800/40 rounded p-1.5">
          <span className="text-gray-300">{k.id}</span>
          <span className="text-gray-600 font-mono text-[9px]">{k.masked}</span>
        </div>
      ))}
    </div>
  )
}