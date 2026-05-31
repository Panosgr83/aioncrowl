import { useState, useEffect } from 'react'
import API from '../config'

export default function FileBrowser({ onClose }) {
  const [agents, setAgents] = useState([])
  const [activeAgentFiles, setActiveAgentFiles] = useState(null)
  const [previewFile, setPreviewFile] = useState(null)
  const [previewContent, setPreviewContent] = useState('')
  const [loadingPreview, setLoadingPreview] = useState(false)

  const fetchFiles = () => {
    fetch(`${API}/api/agents`).then(r=>r.json()).then(d => {
      setAgents(d.agents||[])
      const all = {}
      Promise.all((d.agents||[]).map(a =>
        fetch(`${API}/api/agents/${a.id}/files`).then(r=>r.json()).then(fd => {
          all[a.id] = fd.files||[]
        }).catch(()=>{})
      )).then(() => setActiveAgentFiles(all))
    }).catch(()=>{})
  }

  useEffect(() => { fetchFiles() }, [])

  const deleteFile = async (agentId, filename) => {
    try {
      await fetch(`${API}/api/agents/${agentId}/files/${encodeURIComponent(filename)}`, {method:'DELETE'})
      setActiveAgentFiles(prev => ({
        ...prev,
        [agentId]: (prev[agentId]||[]).filter(f => f.name !== filename)
      }))
    } catch(_) {}
  }

  const openPreview = async (f) => {
    setPreviewFile(f)
    setLoadingPreview(true)
    try {
      const r = await fetch(`${API}/api/files/read?path=${encodeURIComponent(f.path)}`)
      const d = await r.json()
      setPreviewContent(d.content || '(empty file)')
    } catch {
      setPreviewContent('(could not read file)')
    }
    setLoadingPreview(false)
  }

  const TEXT_EXTS = ['.txt','.md','.json','.py','.js','.ts','.jsx','.tsx','.html','.css','.csv','.yml','.yaml','.xml','.ini','.cfg','.env']

  return (
    <div className="p-3 overflow-y-auto h-full text-xs flex flex-col gap-2">
      <div className="flex items-center justify-between mb-2">
        <span className="text-gray-500 uppercase font-medium">Files</span>
        <div className="flex items-center gap-2">
          <button onClick={fetchFiles} className="text-gray-500 hover:text-violet-400 transition-colors text-[10px]">↻</button>
          <button onClick={onClose} className="text-gray-500 hover:text-violet-400 transition-colors text-[10px]">✕</button>
        </div>
      </div>

      {previewFile ? (
        <div className="flex-1 flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-gray-300 truncate text-[10px]">{previewFile.name}</span>
            <div className="flex gap-1">
              <button onClick={() => setPreviewFile(null)} className="text-gray-500 hover:text-gray-300 text-[10px]">← back</button>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto bg-gray-900/50 rounded-lg p-3 border border-gray-800">
            {loadingPreview ? (
              <div className="text-gray-600 animate-pulse">Loading...</div>
            ) : (
              <pre className="text-[10px] text-gray-300 font-mono whitespace-pre-wrap leading-relaxed">{previewContent}</pre>
            )}
          </div>
        </div>
      ) : (
        <>
          {agents.map(a => {
            const files = (activeAgentFiles||{})[a.id]||[]
            if (!files.length) return null
            return (
              <div key={a.id} className="mb-2">
                <div className="text-gray-500 uppercase font-medium text-[10px] mb-1">{a.icon} {a.name}</div>
                <div className="flex flex-col gap-1">
                  {files.map(f => {
                    const fname = f.name || f
                    const fsize = f.size || null
                    const fpath = f.path || ''
                    const ext = '.' + fname.split('.').pop()
                    const canPreview = TEXT_EXTS.includes(ext)
                    return (
                    <div key={fname} className="flex items-center justify-between bg-gray-800/40 rounded p-1.5 group">
                      <button onClick={() => canPreview ? openPreview(f) : null}
                        className="flex-1 min-w-0 text-left">
                        <span className={`text-gray-300 truncate text-[10px] block ${canPreview ? 'hover:text-accent' : ''}`}>{fname}</span>
                        {fsize && <span className="text-gray-600 text-[8px]">{(fsize/1024).toFixed(1)} KB</span>}
                      </button>
                      <div className="flex gap-1 shrink-0 ml-1">
                        {canPreview && <button onClick={() => openPreview(f)}
                          className="text-gray-600 hover:text-accent transition-colors text-[9px] opacity-0 group-hover:opacity-100">👁</button>}
                        <button onClick={() => deleteFile(a.id, fname)}
                          className="text-gray-600 hover:text-red-400 transition-colors text-[9px] opacity-0 group-hover:opacity-100">✕</button>
                      </div>
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
        </>
      )}
    </div>
  )
}