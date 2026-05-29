import { useState, useEffect } from 'react'
import API from '../config'

export default function FileBrowser({ onClose }) {
  const [agents, setAgents] = useState([])
  const [activeAgentFiles, setActiveAgentFiles] = useState(null)

  useEffect(() => {
    fetch(`${API}/api/agents`).then(r=>r.json()).then(d => {
      setAgents(d.agents||[])
      const all = {}
      Promise.all((d.agents||[]).map(a =>
        fetch(`${API}/api/agents/${a.id}/files`).then(r=>r.json()).then(fd => {
          all[a.id] = fd.files||[]
        }).catch(()=>{})
      )).then(() => setActiveAgentFiles(all))
    }).catch(()=>{})
  }, [])

  const deleteFile = async (agentId, filename) => {
    try {
      await fetch(`${API}/api/agents/${agentId}/files/${encodeURIComponent(filename)}`, {method:'DELETE'})
      setActiveAgentFiles(prev => ({
        ...prev,
        [agentId]: (prev[agentId]||[]).filter(f => f !== filename)
      }))
    } catch(_) {}
  }

  return (
    <div className="p-3 overflow-y-auto h-full text-xs flex flex-col gap-2">
      <div className="flex items-center justify-between mb-2">
        <span className="text-gray-500 uppercase font-medium">Files</span>
        <button onClick={onClose} className="text-gray-500 hover:text-violet-400 transition-colors text-[10px]">✕</button>
      </div>
      {agents.map(a => {
        const files = (activeAgentFiles||{})[a.id]||[]
        if (!files.length) return null
        return (
          <div key={a.id} className="mb-2">
            <div className="text-gray-500 uppercase font-medium text-[10px] mb-1">{a.icon} {a.name}</div>
            <div className="flex flex-col gap-1">
              {files.map(f => {
                const fname = typeof f === 'string' ? f : f.name
                const fsize = typeof f === 'string' ? null : f.size
                return (
                <div key={fname} className="flex items-center justify-between bg-gray-800/40 rounded p-1.5 group">
                  <div className="flex-1 min-w-0">
                    <span className="text-gray-300 truncate text-[10px] block">{fname}</span>
                    {fsize && <span className="text-gray-600 text-[8px]">{(fsize/1024).toFixed(1)} KB</span>}
                  </div>
                  <button onClick={() => deleteFile(a.id, fname)}
                    className="text-gray-600 hover:text-red-400 transition-colors text-[9px] opacity-0 group-hover:opacity-100 shrink-0">✕</button>
                </div>
                )
              })}
            </div>
          </div>
        )
      })}
      {agents.every(a => !((activeAgentFiles||{})[a.id]||[]).length) && (
        <div className="text-center py-8 text-gray-600 text-xs">No files uploaded yet.</div>
      )}
    </div>
  )
}