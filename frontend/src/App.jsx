import { useState, useEffect, useRef, useCallback } from 'react'

const API = 'http://127.0.0.1:9789'

import SettingsPanel from './components/SettingsPanel'
import FileBrowser from './components/FileBrowser'
import LeadsPanel from './components/LeadsPanel'

function statusLabel(s) {
  if (!s || s === 'idle') return ''
  if (s === 'writing') return '● Γράφει...'
  if (s === 'receiving') return '● Λαμβάνει...'
  if (s === 'has_response') return '● Απάντησε'
  if (s === 'has_input') return '● Έλαβε input'
  if (s === 'failure') return '⚠️ Σφάλμα'
  return ''
}

function App() {
  const [agents, setAgents] = useState([])
  const [activeAgent, setActiveAgent] = useState('ceo')
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [infoInput, setInfoInput] = useState('')
  const [showInfoInput, setShowInfoInput] = useState(false)
  const [engines, setEngines] = useState([])
  const [selectedEngine, setSelectedEngine] = useState('')
  const [connected, setConnected] = useState(false)
  const [wsStatus, setWsStatus] = useState('disconnected')
  const [typing, setTyping] = useState(false)
  const [currentEngine, setCurrentEngine] = useState('')
  const [sidebarPanel, setSidebarPanel] = useState(null)
  const [sessions, setSessions] = useState({})
  const [activeSession, setActiveSession] = useState(null)
  const [agentHighlights, setAgentHighlights] = useState({})
  const [loadingHistory, setLoadingHistory] = useState(false)
  const [collabEvents, setCollabEvents] = useState([])
  const [agentFiles, setAgentFiles] = useState({})
  const [activeAgents, setActiveAgents] = useState({})
  const [pendingApprovals, setPendingApprovals] = useState([])
  const [readEvents, setReadEvents] = useState([])
  const [taskProgress, setTaskProgress] = useState(null)
  const [currentProject, setCurrentProject] = useState('default')
  const [allProjects, setAllProjects] = useState(['default'])
  const [showProjectInput, setShowProjectInput] = useState(false)
  const clearCollabLog = useCallback(async () => {
    try { await fetch(`${API}/api/collab/clear`, {method:'POST'}) } catch(_) {}
    setCollabEvents([])
  }, [])
  const fileInputRef = useRef(null)
  const wsRef = useRef(null)
  const wsCollabRef = useRef(null)
  const chatRef = useRef(null)
  const infoInputRef = useRef(null)
  const collabRef = useRef(null)
  const pendingRef = useRef({ agentId: null, sessionId: null })
  const activeAgentRef = useRef(activeAgent)
  useEffect(() => { activeAgentRef.current = activeAgent }, [activeAgent])

  const saveMessages = useCallback(async (fullKey, msgs) => {
    try {
      await fetch(`${API}/api/sessions/${encodeURIComponent(fullKey)}/save`, {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({messages: msgs})
      })
    } catch (e) {}
  }, [])

  const loadMessages = useCallback(async (fullKey) => {
    try {
      setLoadingHistory(true)
      const r = await fetch(`${API}/api/sessions/${encodeURIComponent(fullKey)}/load`)
      const d = await r.json()
      if (d.messages?.length) {
        return d.messages
      }
      return []
    } catch (e) { return [] }
    finally { setLoadingHistory(false) }
  }, [])

  useEffect(() => {
    fetch(`${API}/api/engines`).then(r=>r.json()).then(d=>setEngines(d.engines.filter(e=>e.status==='active'))).catch(()=>{})
    fetch(`${API}/api/project`).then(r=>r.json()).then(d => {
      if (d.current) setCurrentProject(d.current)
      if (d.projects) setAllProjects(d.projects)
    }).catch(()=>{})
    fetch(`${API}/api/agents`).then(r=>r.json()).then(d => {
      setAgents(d.agents||[])
      if (d.agents?.length) {
        const id = d.agents[0].id
        setActiveAgent(id)
        setSessions({[id]:[{id:'default',label:'Chat 1',agentId:id}]})
        setActiveSession({agentId:id,sessionId:'default'})
        loadMessages(`${id}:default`).then(msgs => {
          if (msgs.length) setMessages(msgs.map(m => ({...m, ts: m.ts || new Date().toISOString()})))
        })
      }
    }).catch(()=>{})
  }, [])

  const currentAgent = agents.find(a => a.id === activeAgent)
  const agentSessions = sessions[activeAgent] || []

  const displayMessages = messages.filter(m =>
    m._aid === activeAgent && m._sid === (activeSession?.sessionId || 'default')
  )

  const stopGeneration = useCallback(() => {
    if (wsRef.current) { wsRef.current.onclose = null; wsRef.current.close(); wsRef.current = null }
    setTyping(false); setCurrentEngine(''); setShowInfoInput(false); setInfoInput('')
    setTimeout(() => connectWS(), 500)
  }, [])

  const addInfo = useCallback(() => {
    if (wsRef.current) { wsRef.current.onclose = null; wsRef.current.close(); wsRef.current = null }
    setTyping(false); setCurrentEngine(''); setShowInfoInput(true)
    setTimeout(() => { if (infoInputRef.current) { infoInputRef.current.focus(); infoInputRef.current.scrollIntoView({behavior:'smooth'}) } }, 100)
    setTimeout(() => connectWS(), 500)
  }, [])

  const clearCollab = useCallback(async () => {
    try {
      await fetch(`${API}/api/collab/clear`, { method: 'POST' })
    } catch (_) {}
    setCollabEvents([])
  }, [])

  const submitInfo = useCallback(() => {
    if (!infoInput.trim()) return
    const sid = activeSession?.sessionId||'default'; const aid = activeAgent
    const it = infoInput; setShowInfoInput(false); setInfoInput('')
    setMessages(prev => [...prev, {role:'system',content:`📝 Συμπληρωματική πληροφορία: ${it}`,ts:new Date().toISOString(),_aid:aid,_sid:sid}])
    setTimeout(() => sendMessageRef.current(`continue with additional info: ${it}`), 100)
  }, [infoInput, activeAgent, activeSession])

  const sendMessageFn = useCallback((text) => {
    if (!text.trim() || wsRef.current?.readyState !== WebSocket.OPEN) return
    const sid = activeSession?.sessionId||'default'; const aid = activeAgent
    pendingRef.current = {agentId:aid,sessionId:sid}
    setMessages(prev => [...prev, {role:'user',content:text,_aid:aid,_sid:sid,ts:new Date().toISOString()}])
    setInput(''); setTyping(true); setCurrentEngine('')
    wsRef.current.send(JSON.stringify({session_id:`${aid}:${sid}`,message:text,engine_id:selectedEngine,agent_id:aid,tools_enabled:true}))
  }, [activeAgent, activeSession, selectedEngine])

  const sendMessageRef = useRef(sendMessageFn)

  const approveRequest = useCallback(async (req, decision) => {
    const rid = req.request_id || req.id
    try {
      if (decision === 'approve') {
        await fetch(`${API}/api/approvals/${rid}/approve`, { method: 'POST' })
      } else {
        await fetch(`${API}/api/approvals/${rid}/reject`, { method: 'POST' })
      }
    } catch (_) {}
    setPendingApprovals(prev => prev.filter(r => (r.id !== rid && r.request_id !== rid)))
  }, [])
  sendMessageRef.current = sendMessageFn

  const connectWS = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return
    const ws = new WebSocket(`ws://127.0.0.1:9789/ws/chat`)
    wsRef.current = ws; setWsStatus('connecting')
    ws.onopen = () => { setConnected(true); setWsStatus('connected') }
    ws.onmessage = (e) => {
      const data = JSON.parse(e.data)
      const aid = data._aid||pendingRef.current.agentId||'ceo'
      const sid = data._sid||pendingRef.current.sessionId||'default'
      switch (data.type) {
        case 'delta':
          setMessages(prev => {
            const last = prev[prev.length-1]
            if (last?.role==='assistant'&&last._aid===aid&&last._sid===sid) {
              const u=[...prev]; u[u.length-1]={...last,content:last.content+data.content}; return u
            }
            return [...prev,{role:'assistant',content:data.content,_aid:aid,_sid:sid,ts:data.ts||new Date().toISOString()}]
          })
          break
        case 'tool_start': setMessages(prev=>[...prev,{role:'tool_use',name:data.name,args:data.args,_aid:aid,_sid:sid}]); break
        case 'tool_result': setMessages(prev=>[...prev,{role:'tool_result',name:data.name,result:data.result,_aid:aid,_sid:sid}]); break
        case 'status': setCurrentEngine(data.engine); break
        case 'done':
          setTyping(false); setCurrentEngine('')
          setAgentHighlights(prev=>({...prev,[aid]:Date.now()}))
          setMessages(prev => {
            saveMessages(`${aid}:${sid}`, prev.filter(m => m._aid===aid && m._sid===sid))
            return prev
          })
          break
        case 'error': setMessages(prev=>[...prev,{role:'error',content:data.message,_aid:aid,_sid:sid}]); setTyping(false); setCurrentEngine(''); break
      }
    }
    ws.onclose = () => { if(!typing){setConnected(false);setWsStatus('disconnected');wsRef.current=null;setTimeout(connectWS,3000)} }
    ws.onerror = () => ws.close()
  }, [])

  useEffect(() => { connectWS(); return () => { if(wsRef.current){wsRef.current.onclose=null;wsRef.current.close()} }   }, [connectWS])

  // Load uploaded files for active agent
  useEffect(() => {
    if (activeAgent) {
      fetch(`${API}/api/agents/${activeAgent}/files`).then(r=>r.json()).then(d => {
        setAgentFiles(prev => ({...prev, [activeAgent]: d.files||[]}))
      }).catch(()=>{})
    }
  }, [activeAgent])

  // Load collab history on mount
  useEffect(() => {
    fetch(`${API}/api/collab/history`).then(r=>r.json()).then(d => {
      if (d.events?.length) setCollabEvents(d.events.map(e => ({...e, _ts: Date.now()})).slice(-100))
    }).catch(()=>{})
    fetch(`${API}/api/collab/reads`).then(r=>r.json()).then(d => {
      if (d.reads?.length) setReadEvents(d.reads)
    }).catch(()=>{})
    fetch(`${API}/api/approvals/pending`).then(r=>r.json()).then(d => {
      if (d.approvals?.length) setPendingApprovals(d.approvals)
    }).catch(()=>{})
  }, [])
  useEffect(() => {
    let closed = false
    function connectCollab() {
      const ws = new WebSocket(`ws://127.0.0.1:9789/ws/collab`)
      wsCollabRef.current = ws
      ws.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data)
          if (data.type === 'agent_status') {
            setActiveAgents(prev => ({...prev, [data.agent_id]: data.state || (data.active ? 'writing' : 'idle')}))
          } else if (data.type === 'agent_chat') {
            setCollabEvents(prev => [...prev, {...data, _ts: Date.now()}].slice(-100))
            if ((data.agent_id === activeAgentRef.current || activeAgentRef.current === 'ceo') && data.exchange) {
              setMessages(prev => {
                const newMsgs = data.exchange.filter(m =>
                  !prev.some(p => p._aid === m._aid && p._sid === m._sid &&
                    p.content === m.content && p.role === m.role)
                ).map(m => ({...m, ts: m.ts || new Date().toISOString()}))
                return [...prev, ...newMsgs]
              })
            }
          } else if (data.type === 'approval_request') {
            setPendingApprovals(prev => [...prev.filter(r => r.id !== data.request_id && r.request_id !== data.request_id), data])
          } else if (data.type === 'approval_result') {
            setPendingApprovals(prev => prev.filter(r => r.id !== data.request_id && r.request_id !== data.request_id))
            setCollabEvents(prev => [...prev, {...data, _ts: Date.now()}].slice(-100))
          } else if (data.type === 'task_progress') {
            setTaskProgress(data)
            if (data.status === 'complete') {
              setTimeout(() => setTaskProgress(null), 5000)
            }
          } else {
            setCollabEvents(prev => [...prev, {...data, _ts: Date.now()}].slice(-100))
          }
          setTimeout(() => { if (collabRef.current) collabRef.current.scrollTop = collabRef.current.scrollHeight }, 50)
        } catch (_) {}
      }
      ws.onclose = () => { if (!closed) setTimeout(connectCollab, 3000) }
      ws.onerror = () => ws.close()
    }
    connectCollab()
    return () => { closed = true; if (wsCollabRef.current) wsCollabRef.current.onclose = null; wsCollabRef.current?.close() }
  }, [])
  useEffect(() => { if(chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight }, [displayMessages, showInfoInput])

  const handleKeyDown = (e) => { if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendMessageFn(input)} }
  const handleInfoKeyDown = (e) => { if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();submitInfo()} }

  const switchToSession = useCallback(async (agentId, sessionId) => {
    setActiveAgent(agentId); setActiveSession({agentId,sessionId})
    setSelectedEngine(''); setCurrentEngine(''); setShowInfoInput(false)
    const msgs = (await loadMessages(`${agentId}:${sessionId}`)).map(m => ({...m, ts: m.ts || new Date().toISOString()}))
    setMessages(prev => {
      const others = prev.filter(m => !(m._aid===agentId && m._sid===sessionId))
      return [...others, ...msgs]
    })
  }, [])

  const switchAgent = (agentId) => {
    if (!sessions[agentId]?.length) setSessions(prev => ({...prev,[agentId]:[{id:'default',label:'Chat 1',agentId}]}))
    switchToSession(agentId, sessions[agentId]?.[0]?.id || 'default')
  }

  const addSession = () => {
    const id = 'sess_'+Date.now()
    const count = (sessions[activeAgent]?.length||0)+1
    setSessions(prev => ({...prev,[activeAgent]:[...(prev[activeAgent]||[]),{id,label:`Chat ${count}`,agentId:activeAgent}]}))
    setActiveSession({agentId:activeAgent,sessionId:id})
  }

  const navigateToAgent = (agentId, sessionId) => {
    switchToSession(agentId, sessionId||'default')
    setAgentHighlights(prev=>({...prev,[agentId]:0}))
  }

  const sidebarContent = sidebarPanel==='settings' ? <SettingsPanel onClose={()=>setSidebarPanel(null)}/> :
    sidebarPanel==='files' ? <FileBrowser onClose={()=>setSidebarPanel(null)}/> :
    sidebarPanel==='leads' ? <LeadsPanel onClose={()=>setSidebarPanel(null)}/> : null

  return (
    <div className="h-screen flex bg-gray-950 text-gray-100 font-sans">
      {/* LEFT SIDEBAR */}
      <div className="w-56 bg-gray-900 border-r border-gray-800 flex flex-col shrink-0">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
          <h1 className="text-lg font-bold text-violet-400">AIONCLAW</h1>
          <span className={`w-2 h-2 rounded-full ${connected?'bg-green-500':'bg-red-500'}`} />
        </div>
        {sidebarContent ? (
          <div className="flex-1 overflow-hidden">{sidebarContent}</div>
        ) : (
          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="border-b border-gray-800">
              {agents.map(a => (
                <button key={a.id} onClick={()=>switchAgent(a.id)}
                  className={`w-full text-left px-3 py-2.5 transition-colors flex items-center gap-2 border-l-2 ${activeAgent===a.id?'bg-violet-600/20 border-violet-500 text-violet-300':'border-transparent hover:bg-gray-800 text-gray-400'}`}>
                  <span className="relative">
                    {a.icon}
                    {(() => {
                      const st = activeAgents[a.id]
                      if (!st || st === 'idle') return null
                      if (st === 'writing') return <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 bg-green-400 rounded-full animate-pulse" />
                      if (st === 'receiving') return <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 bg-red-400 rounded-full animate-pulse" />
                      if (st === 'has_response') return <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-green-500 rounded-full" />
                      if (st === 'has_input') return <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-red-500 rounded-full" />
                      if (st === 'failure') return <span className="absolute -top-1 -right-1 text-[10px]">⚠️</span>
                      return <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-gray-600 rounded-full" />
                    })()}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{a.name}</div>
                    <div className="text-xs text-gray-600 truncate">{statusLabel(activeAgents[a.id])}</div>
                  </div>
                </button>
              ))}
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-1">
              <div className="text-xs text-gray-600 uppercase tracking-wider px-2 mb-2">{currentAgent?.name} Sessions</div>
              {agentSessions.map(s => (
                <button key={s.id} onClick={()=>switchToSession(activeAgent,s.id)}
                  className={`w-full text-left text-sm px-3 py-1.5 rounded transition-colors flex items-center gap-2 ${activeSession?.sessionId===s.id?'bg-violet-600/30 text-violet-300 border border-violet-500/50':'hover:bg-gray-800 text-gray-400'}`}>
                  <span>💬</span><span>{s.label}</span>
                </button>
              ))}
              <button onClick={addSession} className="w-full text-sm text-gray-500 hover:text-gray-300 px-3 py-1.5 text-left">+ New Chat</button>
            </div>
            <div className="border-t border-gray-800 p-3 space-y-1">
              <button onClick={()=>setSidebarPanel('settings')} className="w-full text-sm text-gray-500 hover:text-gray-300 text-left px-2 py-1.5 rounded hover:bg-gray-800">⚙ Settings</button>
              <button onClick={()=>setSidebarPanel('files')} className="w-full text-sm text-gray-500 hover:text-gray-300 text-left px-2 py-1.5 rounded hover:bg-gray-800">📁 Files</button>
              <button onClick={()=>setSidebarPanel('leads')} className="w-full text-sm text-gray-500 hover:text-gray-300 text-left px-2 py-1.5 rounded hover:bg-gray-800">📊 Leads CRM</button>
              <div className="text-xs text-gray-600 pt-1">{displayMessages.length} msgs</div>
            </div>
            {/* Uploaded files per agent */}
            {agentFiles[activeAgent]?.length > 0 && (
              <div className="border-t border-gray-800 p-3 space-y-1">
                <div className="text-xs text-gray-500 uppercase">📎 Files</div>
                {agentFiles[activeAgent].map((f, i) => (
                  <div key={i} className="flex items-center justify-between text-xs text-gray-400 px-2 py-1 hover:bg-gray-800 rounded">
                    <span className="truncate">{f.name}</span>
                    <div className="flex items-center gap-1.5">
                      {f.source !== activeAgent && <span className="text-[9px] text-violet-400">CEO</span>}
                      <span className="text-gray-600">{(f.size/1024).toFixed(1)}KB</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* CHAT */}
      <div className="flex-1 flex flex-col min-w-0">
        <div className="flex items-center gap-3 px-6 py-2 border-b border-gray-800 bg-gray-900/50 text-xs">
          <span>{currentAgent?.icon}</span>
          <span className="text-violet-400 font-medium">{currentAgent?.name}</span>
          {currentEngine&&<span className="text-gray-500">via {engines.find(e=>e.id===currentEngine)?.name||currentEngine}</span>}
          {typing&&<span className="text-gray-500 animate-pulse">● Generating...</span>}
          {loadingHistory&&<span className="text-gray-500">Loading...</span>}
          <span className="text-gray-600 ml-auto">{agentSessions.find(s=>s.id===activeSession?.sessionId)?.label||'Chat'}</span>
          {displayMessages.length>0&&(
            <button onClick={() => {
              const agent = currentAgent?.name||'Agent'
              const date = new Date().toLocaleDateString('el-GR')
              const msgs = displayMessages.map(m =>
                `<tr><td style="border:1px solid #ddd;padding:8px;background:${m.role==='user'?'#e8d5ff':m.role==='assistant'?'#f0f0f0':'#fff5f5'}"><b>${m.role==='user'?'Εσύ':m.role==='assistant'?'Assistant':m.role==='error'?'Σφάλμα':m.role==='tool_use'?'Εργαλείο: '+m.name:m.role==='tool_result'?'Αποτέλεσμα: '+m.name:m.role}</b><br>${(m.content||JSON.stringify(m.args||'')||m.result||'').replace(/\n/g,'<br>')}</td></tr>`
              ).join('\n')
              const html = `<html><head><meta charset="utf-8"><title>${agent} - ${date}</title></head><body style="font-family:Calibri,sans-serif"><h1>${agent}</h1><p>Ημερομηνία: ${date}</p><table style="border-collapse:collapse;width:100%">${msgs}</table><p style="color:#999;font-size:10px">AIONCLAW - ${new Date().toLocaleString('el-GR')}</p></body></html>`
              const blob = new Blob([html], {type:'application/msword'})
              const url = URL.createObjectURL(blob)
              const a = document.createElement('a'); a.href=url; a.download=`${agent}_${date.replace(/\//g,'-')}.doc`; a.click()
              URL.revokeObjectURL(url)
            }} className="text-gray-500 hover:text-violet-400 transition-colors ml-2" title="Export to Word">📄</button>
          )}
        </div>

        <div ref={chatRef} className="flex-1 overflow-y-auto p-6 space-y-4">
          {displayMessages.length===0&&!loadingHistory&&(
            <div className="h-full flex items-center justify-center text-gray-600">
              <div className="text-center space-y-2">
                <div className="text-4xl">{currentAgent?.icon}</div>
                <div className="text-lg text-gray-400">{currentAgent?.name}</div>
                <div className="text-sm text-gray-600">{currentAgent?.role}</div>
              </div>
            </div>
          )}

          {displayMessages.map((msg,i)=>(
            <div key={i} className={`flex ${msg.role==='user'?'justify-end':msg.role==='system'?'justify-center':'justify-start'}`}>
              <div className={`max-w-[80%] rounded-2xl px-4 py-3 group relative ${
                msg.role==='user'?'bg-violet-600 text-white':
                msg.role==='system'?'bg-amber-900/30 text-amber-300 text-sm border border-amber-800/50':
                msg.role==='error'?'bg-red-900/50 text-red-300 border border-red-800':
                msg.role==='tool_use'?'bg-amber-900/30 text-amber-300 text-sm border border-amber-800/50':
                msg.role==='tool_result'?'bg-gray-800 text-gray-400 text-xs font-mono border border-gray-700':
                'bg-gray-800 text-gray-100'
              }`}>
                {msg.role==='system'&&<div className="whitespace-pre-wrap">{msg.content}</div>}
                {msg.role==='tool_use'&&<><div className="font-medium mb-1">🔧 {msg.name}</div><pre className="text-xs opacity-70">{JSON.stringify(msg.args,null,1).slice(0,200)}</pre></>}
                {msg.role==='tool_result'&&<><div className="text-gray-500 mb-1">← {msg.name}</div><div className="whitespace-pre-wrap">{msg.result}</div></>}
                {(msg.role==='assistant'||msg.role==='user')&&<div className="whitespace-pre-wrap">{msg.content}</div>}
                {msg.role==='error'&&<div className="whitespace-pre-wrap text-sm">{msg.content}</div>}
                {msg.ts && (msg.role==='assistant'||msg.role==='user')&&(
                  <div className={`text-[10px] mt-1 ${msg.role==='user'?'text-violet-300/60':'text-gray-600'}`}>
                    {new Date(msg.ts).toLocaleTimeString('el-GR', {hour:'2-digit',minute:'2-digit'})}
                  </div>
                )}
                {(msg.role==='assistant'||msg.role==='user')&&(
                  <button onClick={()=>navigator.clipboard.writeText(msg.content)}
                    className="absolute -top-2 -right-2 opacity-0 group-hover:opacity-100 transition-opacity bg-gray-700 hover:bg-gray-600 rounded-full w-6 h-6 flex items-center justify-center text-xs text-gray-300"
                    title="Copy">📋</button>
                )}
              </div>
            </div>
          ))}

          {showInfoInput&&(
            <div className="flex justify-center">
              <div className="w-full max-w-lg bg-gray-800/80 border border-amber-700/50 rounded-xl p-4 space-y-3">
                <div className="text-xs text-amber-400 font-medium">📝 Συμπλήρωσε επιπλέον πληροφορίες:</div>
                <textarea ref={infoInputRef} value={infoInput} onChange={e=>setInfoInput(e.target.value)} onKeyDown={handleInfoKeyDown} rows={3}
                  placeholder="Γράψε επιπλέον στοιχεία..."
                  className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-amber-500 resize-none"
                />
                <div className="flex gap-2 justify-end">
                  <button onClick={()=>{setShowInfoInput(false);setInfoInput('')}} className="text-xs text-gray-500 hover:text-gray-300 px-3 py-1.5">Cancel</button>
                  <button onClick={submitInfo} disabled={!infoInput.trim()} className="text-xs bg-amber-600 hover:bg-amber-500 disabled:bg-gray-700 text-white px-4 py-1.5 rounded-lg transition-colors">Continue</button>
                </div>
              </div>
            </div>
          )}

          {typing&&(
            <div className="flex justify-start">
              <div className="bg-gray-800 rounded-2xl px-4 py-3 flex gap-1.5">
                {[0,150,300].map(d=><span key={d} className="w-2 h-2 bg-violet-400 rounded-full animate-bounce" style={{animationDelay:`${d}ms`}}/>)}
              </div>
            </div>
          )}

          {/* TASK PROGRESS BAR */}
          {taskProgress && taskProgress.status !== 'complete' && (
            <div className="flex justify-start">
              <div className="w-full max-w-md bg-gray-800/60 rounded-xl p-3 border border-violet-800/50">
                <div className="flex items-center gap-2 text-xs text-gray-400 mb-1.5">
                  <span className="text-sm">{agents.find(a=>a.id===taskProgress.agent_id)?.icon||'🤖'}</span>
                  <span>{taskProgress.message}</span>
                  <span className="ml-auto text-violet-400">{taskProgress.progress}%</span>
                </div>
                <div className="h-1.5 bg-gray-700 rounded-full overflow-hidden">
                  <div className="h-full bg-violet-500 rounded-full transition-all duration-300" style={{width:`${taskProgress.progress}%`}} />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* PENDING APPROVALS BANNER */}
        {pendingApprovals.length > 0 && (
          <div className="border-t border-amber-800/50 bg-amber-900/20 p-3">
            {pendingApprovals.map(req => (
              <div key={req.id || req.request_id} className="flex items-center gap-3 max-w-4xl mx-auto text-sm">
                <span className="text-amber-400 font-medium shrink-0">⏳ Αίτημα Έγκρισης</span>
                <span className="text-gray-300 truncate flex-1">{req.summary || req.details?.slice(0,100)}</span>
                <button onClick={() => approveRequest(req, 'approve')}
                  className="bg-green-600 hover:bg-green-500 text-white rounded-lg px-3 py-1 text-xs font-medium transition-colors shrink-0">✓ Έγκριση</button>
                <button onClick={() => approveRequest(req, 'reject')}
                  className="bg-red-600/50 hover:bg-red-500 text-white rounded-lg px-3 py-1 text-xs font-medium transition-colors shrink-0">✗ Απόρριψη</button>
              </div>
            ))}
          </div>
        )}

        <div className="border-t border-gray-800 p-4 bg-gray-900/50">
          <div className="flex gap-2 max-w-4xl mx-auto">
            <div className="flex-1 flex gap-2 items-center bg-gray-800 border border-gray-700 rounded-xl px-4 focus-within:border-violet-500">
              <input value={input} onChange={e=>setInput(e.target.value)} onKeyDown={handleKeyDown}
                placeholder={connected?`Μήνυμα στον ${currentAgent?.name}...`:'Connecting...'}
                disabled={!connected||typing}
                className="flex-1 py-3 bg-transparent text-gray-100 placeholder-gray-500 focus:outline-none disabled:opacity-50"
              />
              <button onClick={() => fileInputRef.current?.click()} disabled={typing}
                className="text-gray-500 hover:text-violet-400 transition-colors disabled:opacity-50" title="Upload file">
                📎
              </button>
              <input ref={fileInputRef} type="file" className="hidden" onChange={async (e) => {
                const file = e.target.files?.[0]; if (!file) return
                const form = new FormData(); form.append('file', file)
                try {
                  const r = await fetch(`${API}/api/agents/${activeAgent}/upload`, {method:'POST', body:form})
                  if (r.ok) {
                    const d = await r.json()
                    setMessages(prev => [...prev, {role:'system', content:`📎 Ανέβηκε το αρχείο: ${d.filename}`, _aid:activeAgent, _sid:activeSession?.sessionId||'default'}])
                    // Refresh files
                    const r2 = await fetch(`${API}/api/agents/${activeAgent}/files`)
                    const d2 = await r2.json()
                    setAgentFiles(prev => ({...prev, [activeAgent]: d2.files||[]}))
                  }
                } catch(_) {}
                e.target.value = ''
              }} />
            </div>
            {typing ? (
              <>
                <button onClick={addInfo} className="bg-amber-600 hover:bg-amber-500 text-white rounded-xl px-4 font-medium transition-colors flex items-center gap-1.5 text-sm"><span>✏️</span> Info</button>
                <button onClick={stopGeneration} className="bg-red-600 hover:bg-red-500 text-white rounded-xl px-4 font-medium transition-colors flex items-center gap-1.5 text-sm"><span>■</span> Stop</button>
              </>
            ) : (
              <button onClick={()=>sendMessageFn(input)} disabled={!connected||!input.trim()}
                className="bg-violet-600 hover:bg-violet-500 disabled:bg-gray-700 text-white rounded-xl px-6 font-medium transition-colors disabled:text-gray-500">Send</button>
            )}
          </div>
        </div>
      </div>

      {/* RIGHT SIDEBAR - Collaboration feed */}
      <div className="w-56 bg-gray-900/80 border-l border-gray-800 flex flex-col shrink-0">
        {/* PROJECT HEADER */}
        <div className="px-3 py-2 border-b border-gray-800 text-xs">
          <div className="flex items-center justify-between">
            <span className="text-gray-500 uppercase font-medium">Project</span>
            <button onClick={() => setShowProjectInput(!showProjectInput)} className="text-gray-500 hover:text-violet-400 transition-colors text-[10px]">
              {showProjectInput ? '✕' : '✏️'}
            </button>
          </div>
          {showProjectInput ? (
            <form onSubmit={async (e) => {
              e.preventDefault(); const name = e.target.project.value.trim(); if (!name) return
              try {
                const r = await fetch(`${API}/api/project`, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({name})})
                const d = await r.json()
                if (d.current) setCurrentProject(d.current)
                if (d.projects) setAllProjects(d.projects)
              } catch(_) {}
              setShowProjectInput(false)
              setMessages([])
              switchToSession(activeAgent, activeSession?.sessionId || 'default')
            }} className="flex gap-1 mt-1">
              <input name="project" defaultValue={currentProject==='default'?'':currentProject.replace(/_/g,' ')}
                placeholder="project name..."
                className="flex-1 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-100 placeholder-gray-500 focus:outline-none focus:border-violet-500"
              />
            </form>
          ) : (
            <div className="flex items-center gap-1 mt-1">
              <span className="text-violet-300 font-medium text-sm truncate">{currentProject === 'default' ? 'Κανένα' : currentProject.replace(/_/g, ' ')}</span>
            </div>
          )}
          {/* Recent projects */}
          {allProjects.length > 1 && !showProjectInput && (
            <div className="flex flex-wrap gap-1 mt-1">
              {allProjects.filter(p => p !== 'default').map(p => (
                <div key={p} className="flex items-center gap-0.5">
                  <button onClick={async () => {
                    try {
                      await fetch(`${API}/api/project`, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({name:p})})
                      const d = await (await fetch(`${API}/api/project`)).json()
                      setCurrentProject(d.current || p)
                      setAllProjects(d.projects || [])
                      setMessages([])
                      switchToSession(activeAgent, activeSession?.sessionId || 'default')
                    } catch(_) {}
                  }}
                    className={`text-[10px] px-1.5 py-0.5 rounded ${p === currentProject ? 'bg-violet-600/30 text-violet-300' : 'bg-gray-800 text-gray-500 hover:text-gray-300'}`}>
                    {p.replace(/_/g, ' ')}
                  </button>
                  {p !== currentProject && (
                    <button onClick={async (e) => {
                      e.stopPropagation()
                      if (!confirm(`Delete project "${p.replace(/_/g, ' ')}"?\nChat history will be removed but central memory is preserved.`)) return
                      try {
                        const r = await fetch(`${API}/api/project/${encodeURIComponent(p)}`, {method:'DELETE'})
                        const d = await r.json()
                        if (d.ok) {
                          const resp = await fetch(`${API}/api/project`)
                          const pd = await resp.json()
                          setCurrentProject(pd.current || 'default')
                          setAllProjects(pd.projects || ['default'])
                          setMessages([])
                          switchToSession(activeAgent, activeSession?.sessionId || 'default')
                        }
                      } catch(_) {}
                    }} className="text-gray-600 hover:text-red-400 transition-colors text-[9px] px-0.5" title="Delete project">✕</button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
        {/* TEAM ACTIVITY */}
        <div className="px-3 py-2 border-b border-gray-800 text-xs text-gray-500 uppercase font-medium flex items-center justify-between gap-2">
          Team Activity
          <button onClick={clearCollabLog} className="text-gray-600 hover:text-red-400 transition-colors text-[10px]" title="Clear activity">✕</button>
        </div>
        <div ref={collabRef} className="flex-1 overflow-y-auto p-2 space-y-1">
          {collabEvents.length === 0 && (
            <div className="text-center py-8 text-gray-600 text-xs">No activity yet.<br/>Send a message to CEO to start collaboration.</div>
          )}
          {[...collabEvents].reverse().map((ev, ri) => {
            const isRead = readEvents.includes(ev.id)
            const fromAgent = agents.find(a => a.id === ev.from)
            const toAgent = agents.find(a => a.id === ev.to)
            return (
              <button key={ev.id||ri} onClick={()=>{
                if (ev.id) fetch(`${API}/api/collab/events/${ev.id}/read`, {method:'POST'}).catch(()=>{})
                setReadEvents(prev => prev.includes(ev.id) ? prev : [...prev, ev.id])
                navigateToAgent(ev.to === 'ceo' ? ev.from : ev.to, 'default')
              }}
                className={`w-full text-left rounded-lg p-2.5 border transition-colors ${
                  isRead ? 'bg-gray-900/30 border-gray-800/30' : 'bg-gray-800/40 border-gray-800 hover:bg-gray-700/50'
                }`}>
                <div className={`flex items-center gap-1.5 mb-1 ${isRead ? 'opacity-40' : ''}`}>
                  <span className="text-sm">{fromAgent?.icon||'🤖'}</span>
                  <span className={`text-[10px] font-medium ${isRead ? 'text-gray-600 line-through' : 'text-gray-400'}`}>
                    {fromAgent?.name||ev.from} → {toAgent?.name||ev.to}
                  </span>
                  <span className={`ml-auto w-2 h-2 rounded-full ${
                    activeAgents[ev.from]==='writing'||activeAgents[ev.to]==='writing'?'bg-green-400 animate-pulse':
                    activeAgents[ev.from]==='receiving'||activeAgents[ev.to]==='receiving'?'bg-red-400 animate-pulse':
                    activeAgents[ev.from]==='has_response'||activeAgents[ev.to]==='has_response'?'bg-green-500':
                    activeAgents[ev.from]==='failure'||activeAgents[ev.to]==='failure'?'bg-yellow-500':
                    'bg-gray-600'
                  }`} />
                </div>
                <div className={`text-xs ${isRead ? 'opacity-30 line-through text-gray-600' : ev.action === 'delegate' ? 'text-amber-300' : ev.action === 'result' ? 'text-green-300' : 'text-gray-300'}`}>
                  {ev.action === 'delegate' ? '📋 Ανάθεση' : ev.action === 'result' ? '✅ Αποτέλεσμα' : ev.action}
                </div>
                <div className={`text-[11px] mt-0.5 line-clamp-3 ${isRead ? 'text-gray-600 line-through opacity-40' : 'text-gray-400'}`}>{ev.content}</div>
                <div className={`text-[9px] mt-1 ${isRead ? 'text-gray-700' : 'text-gray-600'}`}>{new Date(ev.ts).toLocaleTimeString('el-GR')}</div>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

export default App
