import { useState, useEffect, useRef } from 'react'
import API from '../config'

export default function FileBrowser({ onClose }) {
  const [agents, setAgents] = useState([])
  const [activeAgentFiles, setActiveAgentFiles] = useState(null)
  const [previewFile, setPreviewFile] = useState(null)
  const [previewContent, setPreviewContent] = useState('')
  const [loadingPreview, setLoadingPreview] = useState(false)
  const [view, setView] = useState('agents') // agents | all
  const [allFiles, setAllFiles] = useState([])
  const [loadingZip, setLoadingZip] = useState(false)
  const [uploadAgent, setUploadAgent] = useState('ceo')
  const [uploading, setUploading] = useState(false)
  const [uploadMsg, setUploadMsg] = useState('')
  const fileInputRef = useRef(null)

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

  const fetchAllFiles = () => {
    fetch(`${API}/api/project/files`).then(r=>r.json()).then(d => {
      setAllFiles(d.files||[])
    }).catch(()=>{})
  }

  useEffect(() => { fetchFiles() }, [])

  useEffect(() => {
    if (view === 'all') fetchAllFiles()
  }, [view])

  const deleteFile = async (agentId, filename) => {
    try {
      await fetch(`${API}/api/agents/${agentId}/files/${encodeURIComponent(filename)}`, {method:'DELETE'})
      setActiveAgentFiles(prev => ({
        ...prev,
        [agentId]: (prev[agentId]||[]).filter(f => f.name !== filename)
      }))
      if (view === 'all') fetchAllFiles()
    } catch(_) {}
  }

  const getFilePath = (f, agentId) => {
    return f.path || `~/AION/aionclaw/uploads/${agentId}/${f.name}`
  }

  const openPreview = async (f, agentId) => {
    setPreviewFile({...f, _agentId: agentId})
    setLoadingPreview(true)
    try {
      const fp = getFilePath(f, agentId)
      const r = await fetch(`${API}/api/files/read?path=${encodeURIComponent(fp)}`)
      const d = await r.json()
      setPreviewContent(d.content || '(empty file)')
    } catch {
      setPreviewContent('(could not read file)')
    }
    setLoadingPreview(false)
  }

  const downloadZip = async (path) => {
    setLoadingZip(true)
    try {
      const url = path ? `${API}/api/files/zip?path=${encodeURIComponent(path)}` : `${API}/api/files/zip`
      const a = document.createElement('a')
      a.href = url
      a.download = 'aionclaw_files.zip'
      a.click()
    } catch(_) {}
    setLoadingZip(false)
  }

  const downloadFile = (fpath, fname) => {
    const a = document.createElement('a')
    a.href = `${API}/api/files/download?path=${encodeURIComponent(fpath)}`
    a.download = fname
    a.click()
  }

  const TEXT_EXTS = ['.txt','.md','.json','.py','.js','.ts','.jsx','.tsx','.html','.css','.csv','.yml','.yaml','.xml','.ini','.cfg','.env']

  const fmtModified = (ts) => {
    if (!ts) return ''
    try {
      const d = new Date(ts)
      return d.toLocaleDateString('el-GR', {day:'2-digit',month:'2-digit',year:'numeric'})
        + ' ' + d.toLocaleTimeString('el-GR', {hour:'2-digit',minute:'2-digit'})
    } catch { return ts.slice(0,16)||'' }
  }

  const handleUpload = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true); setUploadMsg('')
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('agent_id', uploadAgent)
      const r = await fetch(`${API}/api/files/upload`, {method:'POST', body: fd})
      const d = await r.json()
      if (d.status === 'ok') {
        setUploadMsg(`✅ ${d.filename}`)
        fetchFiles()
      } else {
        setUploadMsg('❌ upload failed')
      }
    } catch {
      setUploadMsg('❌ upload error')
    }
    setUploading(false)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  return (
    <div className="p-3 overflow-y-auto h-full text-xs flex flex-col gap-2">
      <div className="flex items-center justify-between mb-2">
        <span className="text-gray-500 uppercase font-medium">Files</span>
        <div className="flex items-center gap-2">
          <select value={uploadAgent} onChange={e => setUploadAgent(e.target.value)}
            className="bg-gray-800 text-gray-400 text-[9px] border border-gray-700 rounded px-1 py-0.5 w-16">
            {agents.map(a => <option key={a.id} value={a.id}>{a.icon||a.id}</option>)}
          </select>
          <input type="file" ref={fileInputRef} onChange={handleUpload} className="hidden" />
          <button onClick={() => fileInputRef.current?.click()} disabled={uploading}
            className="text-gray-500 hover:text-violet-400 transition-colors text-[10px]">
            {uploading ? '⏳' : '⬆'}
          </button>
          {uploadMsg && <span className="text-[8px] text-green-500 truncate max-w-20">{uploadMsg}</span>}
          <button onClick={() => setView(view === 'agents' ? 'all' : 'agents')}
            className="text-gray-500 hover:text-violet-400 transition-colors text-[10px]">
            {view === 'agents' ? '📁 All' : '📂 Agents'}
          </button>
          <button onClick={view === 'all' ? fetchAllFiles : fetchFiles}
            className="text-gray-500 hover:text-violet-400 transition-colors text-[10px]">↻</button>
          <button onClick={onClose} className="text-gray-500 hover:text-violet-400 transition-colors text-[10px]">✕</button>
        </div>
      </div>

      {previewFile ? (
        <div className="flex-1 flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-gray-300 break-all text-[10px]">{previewFile.name}</span>
            <div className="flex gap-1">
              <button onClick={() => downloadFile(getFilePath(previewFile, previewFile._agentId), previewFile.name)}
                className="text-gray-500 hover:text-accent text-[10px]">⬇</button>
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
      ) : view === 'all' ? (
        <>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-gray-600 text-[10px]">{allFiles.length} files</span>
            <button onClick={() => downloadZip()}
              className="ml-auto text-[10px] bg-purple-500/20 text-purple-400 hover:bg-purple-500/30 px-2 py-1 rounded transition-colors">
              {loadingZip ? '⏳' : '⬇ All ZIP'}
            </button>
          </div>
          <div className="flex flex-col gap-1">
            {allFiles.sort((a,b) => (b.modified||'').localeCompare(a.modified||'')).map(f => {
              const agent = agents.find(a => a.id === f.agent)
              const ext = '.' + f.name.split('.').pop()
              const canPreview = TEXT_EXTS.includes(ext)
              const fp = f.path || `~/AION/aionclaw/uploads/${f.agent}/${f.name}`
              return (
                <div key={f.path || f.name} className="flex items-center justify-between bg-gray-800/40 rounded p-1.5 group">
                  <button onClick={() => canPreview ? openPreview(f, f.agent) : downloadFile(fp, f.name)}
                    className="flex-1 min-w-0 text-left">
                    <div className="flex items-center gap-1">
                      <span className="text-[9px]">{agent?.icon||'📄'}</span>
                      <span className="text-gray-300 break-all text-[10px] block">{f.name}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-gray-600 text-[8px]">{(f.size/1024).toFixed(1)} KB</span>
                      <span className="text-gray-700 text-[8px]">· {fmtModified(f.modified)}</span>
                      <span className="text-gray-700 text-[8px]">· {f.agent}</span>
                    </div>
                  </button>
                  <div className="flex gap-1 shrink-0 ml-1">
                    <button onClick={() => downloadFile(fp, f.name)}
                      className="text-gray-600 hover:text-accent transition-colors text-[9px] opacity-0 group-hover:opacity-100">⬇</button>
                    <button onClick={() => deleteFile(f.agent, f.name)}
                      className="text-gray-600 hover:text-red-400 transition-colors text-[9px] opacity-0 group-hover:opacity-100">✕</button>
                  </div>
                </div>
              )
            })}
            {allFiles.length === 0 && (
              <div className="text-center py-8 text-gray-600 text-xs">No project files yet.</div>
            )}
          </div>
        </>
      ) : (
        <>
              {agents.map(a => {
            const files = (activeAgentFiles||{})[a.id]||[]
            if (!files.length) return null
            const agentPath = `~/AION/aionclaw/uploads/${a.id}`
            return (
              <div key={a.id} className="mb-2">
                <div className="flex items-center justify-between">
                  <span className="text-gray-500 uppercase font-medium text-[10px] mb-1">{a.icon} {a.name}</span>
                  <button onClick={() => downloadZip(agentPath)}
                    className="text-gray-600 hover:text-accent text-[8px]">⬇ ZIP</button>
                </div>
                <div className="flex flex-col gap-1">
                  {[...files].sort((a,b) => (b.modified||'').localeCompare(a.modified||'')).map(f => {
                    const fname = f.name || f
                    const fsize = f.size || null
                    const fpath = getFilePath(f, a.id)
                    const ext = '.' + fname.split('.').pop()
                    const canPreview = TEXT_EXTS.includes(ext)
                    return (
                    <div key={fname} className="flex items-center justify-between bg-gray-800/40 rounded p-1.5 group">
                      <button onClick={() => canPreview ? openPreview(f, a.id) : downloadFile(fpath, fname)}
                        className="flex-1 min-w-0 text-left">
                        <span className={`text-gray-300 break-all text-[10px] block ${canPreview ? 'hover:text-accent' : ''}`}>{fname}</span>
                        {fsize && <span className="text-gray-600 text-[8px]">{(fsize/1024).toFixed(1)} KB · {fmtModified(f.modified)}</span>}
                      </button>
                      <div className="flex gap-1 shrink-0 ml-1">
                        <button onClick={() => downloadFile(fpath, fname)}
                          className="text-gray-600 hover:text-accent transition-colors text-[9px] opacity-0 group-hover:opacity-100">⬇</button>
                        {canPreview && <button onClick={() => openPreview(f, a.id)}
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