import { useState, useEffect } from 'react'
import API from '../config'

export default function SettingsPanel({ onClose }) {
  const [engines, setEngines] = useState([])
  const [statuses, setStatuses] = useState({})
  const [keys, setKeys] = useState([])
  const [perf, setPerf] = useState(null)

  useEffect(() => {
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
  }, [])

  return (
    <div className="p-3 overflow-y-auto h-full text-xs flex flex-col gap-2">
      <div className="flex items-center justify-between mb-2">
        <span className="text-gray-500 uppercase font-medium">Settings</span>
        <button onClick={onClose} className="text-gray-500 hover:text-violet-400 transition-colors text-[10px]">✕</button>
      </div>

      <div className="text-gray-500 uppercase font-medium text-[10px] mt-2 mb-1">Engines</div>
      {engines.map(e => {
        const p = perf?.stats?.[e.id] || {}
        const speedColor = e.speed_rating === 'very_fast' ? 'text-green-400' : e.speed_rating === 'fast' ? 'text-emerald-400' : e.speed_rating === 'medium' ? 'text-yellow-400' : 'text-orange-400'
        return (
        <div key={e.id} className="flex items-center justify-between bg-gray-800/60 rounded p-2">
          <div className="flex-1 min-w-0">
            <div className="text-gray-200 font-medium flex items-center gap-1">
              {e.name}
              <span className={`text-[8px] font-mono ${speedColor}`}>{e.speed_rating}</span>
              <span className="text-[8px] text-gray-600 font-mono">⚡{e.capability}</span>
            </div>
            <div className="text-gray-500 text-[9px]">#{e.priority} {e.model}</div>
            {p.calls > 0 && (
              <div className="text-gray-600 text-[8px] mt-0.5">
                {p.calls} calls · avg {p.avg_time}s · {p.success_rate}% success
              </div>
            )}
          </div>
          <div className={`flex items-center gap-1 text-[9px] ${e.status === 'active' ? 'text-green-400' : 'text-red-400'}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${e.status === 'active' ? 'bg-green-400' : 'bg-red-400'}`} />
            {e.status}
          </div>
        </div>
      )})}

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
      {keys.map(k => (
        <div key={k.id} className="flex items-center justify-between bg-gray-800/40 rounded p-1.5">
          <span className="text-gray-300">{k.id}</span>
          <span className="text-gray-600 font-mono text-[9px]">{k.masked}</span>
        </div>
      ))}
    </div>
  )
}
