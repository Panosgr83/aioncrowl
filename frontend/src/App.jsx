import { useState, useEffect, useRef, useCallback } from 'react'

const API = 'http://127.0.0.1:9790'

import SettingsPanel from './components/SettingsPanel'
import FileBrowser from './components/FileBrowser'
import LeadsPanel from './components/LeadsPanel'

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
  const [currentTool, setCurrentTool] = useState(null)
  const [performanceData, setPerformanceData] = useState(null)
  const [showPerformance, setShowPerformance] = useState(false)
  const [showCollab, setShowCollab] = useState(true)
  const [thinkingEvents, setThinkingEvents] = useState([])
  const [compactView, setCompactView] = useState(false)

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
      return d.messages?.length ? d.messages : []
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
  const recentThinking = thinkingEvents.slice(-5).reverse()

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
    try { await fetch(`${API}/api/collab/clear`, { method: 'POST' }) } catch (_) {}
    setCollabEvents([])
    setThinkingEvents([])
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
    setInput(''); setTyping(true); setCurrentEngine(''); setCurrentTool(null)
    wsRef.current.send(JSON.stringify({session_id:`${aid}:${sid}`,message:text,engine_id:selectedEngine,agent_id:aid,tools_enabled:true}))
  }, [activeAgent, activeSession, selectedEngine])
  const sendMessageRef = useRef(sendMessageFn)

  const approveRequest = useCallback(async (req, decision) => {
    const rid = req.request_id || req.id
    try {
      if (decision === 'approve') await fetch(`${API}/api/approvals/${rid}/approve`, { method: 'POST' })
      else await fetch(`${API}/api/approvals/${rid}/reject`, { method: 'POST' })
    } catch (_) {}
    setPendingApprovals(prev => prev.filter(r => (r.id !== rid && r.request_id !== rid)))
  }, [])
  sendMessageRef.current = sendMessageFn

  const wsReconnectTimer = useRef(null)
  const wsConnectAttempt = useRef(0)
  const wsTimeoutRef = useRef(null)

  const connectWS = useCallback(() => {
    // Kill any existing socket/state before creating a new one
    if (wsTimeoutRef.current) { clearTimeout(wsTimeoutRef.current); wsTimeoutRef.current = null }
    if (wsReconnectTimer.current) { clearTimeout(wsReconnectTimer.current); wsReconnectTimer.current = null }
    if (wsRef.current) {
      try { wsRef.current.onclose = null; wsRef.current.onerror = null; wsRef.current.close() } catch(_) {}
      wsRef.current = null
    }

    const ws = new WebSocket(`ws://127.0.0.1:9790/ws/chat`)
    wsRef.current = ws
    setWsStatus('connecting')
    wsConnectAttempt.current += 1
    const attempt = wsConnectAttempt.current

    // Timeout: if not open in 5s, close and retry
    wsTimeoutRef.current = setTimeout(() => {
      if (ws.readyState !== WebSocket.OPEN && wsRef.current === ws) {
        try { ws.close() } catch(_) {}
      }
    }, 5000)

    ws.onopen = () => {
      if (wsRef.current !== ws) return
      wsTimeoutRef.current = null
      wsConnectAttempt.current = 0
      setConnected(true)
      setWsStatus('connected')
    }

    ws.onmessage = (e) => {
      const data = JSON.parse(e.data)
      const aid = data._aid||pendingRef.current.agentId||'ceo'
      const sid = data._sid||pendingRef.current.sessionId||'default'
      switch (data.type) {
        case 'delta':
          setCurrentTool(null)
          setMessages(prev => {
            const last = prev[prev.length-1]
            if (last?.role==='assistant'&&last._aid===aid&&last._sid===sid) {
              const u=[...prev]; u[u.length-1]={...last,content:last.content+data.content}; return u
            }
            return [...prev,{role:'assistant',content:data.content,_aid:aid,_sid:sid,ts:data.ts||new Date().toISOString()}]
          })
          break
        case 'tool_start': setMessages(prev=>[...prev,{role:'tool_use',name:data.name,args:data.args,_aid:aid,_sid:sid}]); setCurrentTool(data.name); break
        case 'tool_result': setMessages(prev=>[...prev,{role:'tool_result',name:data.name,result:data.result,_aid:aid,_sid:sid}]); setCurrentTool(null); break
        case 'status': setCurrentEngine(data.engine); break
        case 'done':
          setTyping(false); setCurrentEngine(''); setCurrentTool(null)
          setAgentHighlights(prev=>({...prev,[aid]:Date.now()}))
          setMessages(prev => {
            saveMessages(`${aid}:${sid}`, prev.filter(m => m._aid===aid && m._sid===sid))
            return prev
          })
          break
        case 'error': setMessages(prev=>[...prev,{role:'error',content:data.message,_aid:aid,_sid:sid}]); setTyping(false); setCurrentEngine(''); break
      }
    }

    ws.onclose = () => {
      if (wsTimeoutRef.current) { clearTimeout(wsTimeoutRef.current); wsTimeoutRef.current = null }
      if (wsRef.current === ws) wsRef.current = null
      setConnected(false)
      setWsStatus('disconnected')
      const delay = Math.min(3000 * (1 + wsConnectAttempt.current), 15000)
      wsReconnectTimer.current = setTimeout(() => connectWS(), delay)
    }

    ws.onerror = () => { if (wsRef.current === ws) { try { ws.close() } catch(_) {} } }
  }, [])

  useEffect(() => {
    connectWS()
    return () => {
      if (wsTimeoutRef.current) clearTimeout(wsTimeoutRef.current)
      if (wsReconnectTimer.current) clearTimeout(wsReconnectTimer.current)
      // Let onclose fire normally so reconnect isn't suppressed
      if (wsRef.current) { try { wsRef.current.close() } catch(_) {} }
    }
  }, [connectWS])

  useEffect(() => {
    if (activeAgent) {
      fetch(`${API}/api/agents/${activeAgent}/files`).then(r=>r.json()).then(d => {
        setAgentFiles(prev => ({...prev, [activeAgent]: d.files||[]}))
      }).catch(()=>{})
    }
  }, [activeAgent])

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
      const ws = new WebSocket(`ws://127.0.0.1:9790/ws/collab`)
      wsCollabRef.current = ws
      ws.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data)
          if (data.type === 'agent_status') {
            setActiveAgents(prev => ({...prev, [data.agent_id]: data.state || (data.active ? 'writing' : 'idle')}))
          } else if (data.type === 'agent_thinking') {
            setThinkingEvents(prev => [...prev, {...data, _ts: Date.now()}].slice(-50))
            setCollabEvents(prev => [...prev, {...data, _ts: Date.now()}].slice(-100))
            if (data.status === 'started' && data.agent_id !== activeAgentRef.current) {
              const a = agents.find(x => x.id === data.agent_id)
              setMessages(prev => {
                const exists = prev.some(m => m._aid === data.agent_id && m.role === 'system' && m.content?.includes('ξεκινά'))
                if (exists) return prev
                return [...prev, {role:'system', content:`⏳ ${a?.icon||''} ${a?.name||data.agent_id} ξεκινά εργασία... (εκτίμ. ${data.estimated_seconds||'?'}s)`, _aid: activeAgentRef.current, _sid: pendingRef.current.sessionId||'default', ts: new Date().toISOString()}]
              })
            }
            if (data.status === 'complete' && data.agent_id !== activeAgentRef.current) {
              const a = agents.find(x => x.id === data.agent_id)
              setMessages(prev => [...prev, {role:'system', content:`✅ ${a?.icon||''} ${a?.name||data.agent_id} ολοκλήρωσε σε ${data.duration_s||'?'}s`, _aid: activeAgentRef.current, _sid: pendingRef.current.sessionId||'default', ts: new Date().toISOString()}])
            }
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
            if (data.status === 'complete') setTimeout(() => setTaskProgress(null), 8000)
            setCollabEvents(prev => [...prev, {...data, _ts: Date.now()}].slice(-100))
          } else if (data.type === 'file_updated') {
            if (data.agent_id) fetch(`${API}/api/agents/${data.agent_id}/files`).then(r=>r.json()).then(d => {
              setAgentFiles(prev => ({...prev, [data.agent_id]: d.files||[]}))
            }).catch(()=>{})
          } else {
            setCollabEvents(prev => [...prev, {...data, _ts: Date.now()}].slice(-100))
          }
        } catch (_) {}
      }
      ws.onclose = () => { if (!closed) setTimeout(connectCollab, 3000) }
      ws.onerror = () => ws.close()
    }
    connectCollab()
    return () => { closed = true; if (wsCollabRef.current) wsCollabRef.current.onclose = null; wsCollabRef.current?.close() }
  }, [])

  useEffect(() => { if(chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight }, [displayMessages, showInfoInput, thinkingEvents])

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

  const exportWord = useCallback(() => {
    const agent = currentAgent?.name||'Agent'
    const project = currentProject === 'default' ? '' : currentProject.replace(/_/g, ' ')
    const date = new Date().toLocaleDateString('el-GR')
    const rows = displayMessages.map((m, i) => {
      const roleLabel = m.role==='user'?'Χρήστης':m.role==='assistant'?'Απάντηση':m.role==='error'?'Σφάλμα':m.role==='tool_use'?'Εργαλείο: '+m.name:m.role==='tool_result'?'Αποτέλεσμα: '+m.name:m.role
      const content = (m.content||JSON.stringify(m.args||'')||m.result||'').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>')
      const bg = m.role==='user'?'#f0f0ff':m.role==='assistant'?'#fafafa':m.role==='error'?'#fff0f0':'#fffbe6'
      return `<tr${m.role==='assistant'?' style="border-top:2px solid #7c3aed"':''}><td style="padding:10px 16px;background:${bg};text-align:${m.role==='user'?'right':'left'}"><div style="font-weight:600;font-size:11px;color:#666;margin-bottom:4px;text-transform:uppercase;letter-spacing:0.5px">${roleLabel}${m.ts?' · '+new Date(m.ts).toLocaleTimeString('el-GR',{hour:'2-digit',minute:'2-digit'}):''}</div><div style="font-size:12px;line-height:1.6;color:#222">${content}</div></td></tr>`
    }).join('\n')
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${agent} - ${date}</title><style>body{font-family:Calibri,'Segoe UI',Arial,sans-serif;max-width:900px;margin:40px auto;padding:0 20px}h1{color:#7c3aed;font-size:24px;border-bottom:3px solid #7c3aed;padding-bottom:8px}.meta{color:#888;font-size:12px;margin:8px 0 24px 0}table{width:100%;border-collapse:collapse}</style></head><body><h1>${agent}</h1>${project?`<p style="color:#7c3aed;font-size:14px"><strong>Project:</strong> ${project}</p>`:''}<div class="meta">📅 ${date} · AIONCLAW</div><table>${rows}</table></body></html>`
    const blob = new Blob([html], {type:'application/msword'})
    const a = document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=`${agent}_${date.replace(/\//g,'-')}.doc`; a.click()
    URL.revokeObjectURL(URL)
  }, [displayMessages, currentAgent, currentProject])

  const exportExcel = useCallback(() => {
    const agent = currentAgent?.name||'Agent'
    const date = new Date().toLocaleDateString('el-GR')
    const rows = displayMessages.map((m, i) => {
      const roleLabel = m.role==='user'?'User':m.role==='assistant'?'Assistant':m.role==='error'?'Error':m.role==='tool_use'?`Tool: ${m.name}`:m.role==='tool_result'?`Result: ${m.name}`:m.role
      const content = (m.content||JSON.stringify(m.args||'')||m.result||'').replace(/"/g,'""')
      return `"${roleLabel}","${(m.ts||'').replace(/"/g,'""')}","${content.replace(/\n/g,'↵ ')}"`
    }).join('\n')
    const csv = `Agent,Date,Role,Timestamp,Message\n"${agent}","${date}",,,,,,,,\n${rows}`
    const blob = new Blob(["\uFEFF"+csv], {type:'text/csv;charset=utf-8'})
    const a = document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=`${agent}_${date.replace(/\//g,'-')}.csv`; a.click()
    URL.revokeObjectURL(URL)
  }, [displayMessages, currentAgent])

  const perfPanel = showPerformance && performanceData ? (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center" onClick={()=>setShowPerformance(false)}>
      <div className="bg-gray-900 border border-gray-700 rounded-xl max-w-lg w-full mx-4 max-h-[70vh] overflow-y-auto" onClick={e=>e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700 sticky top-0 bg-gray-900">
          <span className="text-xs font-medium text-violet-400">⚡ Performance Report</span>
          <button onClick={()=>setShowPerformance(false)} className="text-gray-500 hover:text-gray-300 text-xs">✕</button>
        </div>
        <div className="p-4 text-xs text-gray-300 font-mono whitespace-pre-wrap leading-relaxed">{performanceData.report}</div>
        <div className="px-4 py-3 border-t border-gray-700 flex gap-2">
          <button onClick={async()=>{try{const r=await fetch(`${API}/api/performance`);setPerformanceData(await r.json())}catch(_){}}}
            className="text-[10px] text-gray-500 hover:text-gray-300">Refresh</button>
          <button onClick={()=>{setShowPerformance(false)}}
            className="text-[10px] text-violet-400 hover:text-violet-300 ml-auto">Close</button>
        </div>
      </div>
    </div>
  ) : null

  const agentThinks = (ev) => {
    const icon = agents.find(a=>a.id===ev.agent_id)?.icon||'🤖'
    const colors = {started:'border-blue-800/30 bg-blue-900/10',
      thinking:'border-indigo-800/30 bg-indigo-900/10',
      synthesizing:'border-violet-800/30 bg-violet-900/10',
      complete:'border-green-800/30 bg-green-900/10',
      error:'border-red-800/30 bg-red-900/10'}
    const pulses = {started:'bg-blue-400',thinking:'bg-indigo-400',synthesizing:'bg-violet-400'}
    const c = colors[ev.status]||'border-gray-800/30 bg-gray-900/10'
    const p = pulses[ev.status]
    return (
      <div key={ev.id||ev._ts} className={`rounded-lg p-2 border ${c} transition-all duration-300`}>
        <div className="flex items-center gap-1.5 mb-0.5">
          <span className="text-xs">{icon}</span>
          <span className="text-[10px] font-medium text-gray-400">{ev.agent_id}</span>
          {p&&<span className={`w-1.5 h-1.5 rounded-full ${p} animate-pulse ml-auto`}/>}
          {ev.status==='complete'&&<span className="text-[9px] text-green-500 ml-auto">✓</span>}
          {ev.status==='error'&&<span className="text-[9px] text-red-500 ml-auto">✕</span>}
        </div>
        <div className="text-[10px] text-gray-400 leading-relaxed">{ev.thought}</div>
        {ev.remaining_seconds>0&&ev.status!=='complete'&&ev.status!=='error'&&(
          <div className="mt-1 flex items-center gap-2">
            <div className="flex-1 h-1 bg-gray-700 rounded-full overflow-hidden">
              <div className="h-full bg-violet-500 rounded-full animate-pulse" style={{width:`${Math.min(100,ev.progress||50)}%`}}/>
            </div>
            <span className="text-[9px] text-violet-400 shrink-0">~{ev.remaining_seconds}s</span>
          </div>
        )}
        {ev.duration_s&&<div className="text-[9px] text-green-600 mt-0.5">{ev.duration_s}s</div>}
        <div className="text-[8px] text-gray-700 mt-0.5">{new Date(ev.ts).toLocaleTimeString('el-GR')}</div>
      </div>
    )
  }

  return (
    <div className="h-screen flex flex-col bg-gray-950 text-gray-100 font-sans overflow-hidden">
      {/* TOP PROJECT BAR */}
      <div className="flex items-center gap-1 px-4 py-1.5 bg-gray-900 border-b border-gray-800 shrink-0 overflow-x-auto z-10">
        <span className="text-violet-400 font-bold text-sm mr-2 shrink-0">AIONCLAW</span>
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${connected?'bg-green-500 animate-pulse':'bg-red-500'}`} />
        <div className="h-4 w-px bg-gray-700 mx-2 shrink-0" />
        {allProjects.filter(p => p !== 'default').map(p => (
          <button key={p} onClick={async () => {
            try {
              await fetch(`${API}/api/project`, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({name:p})})
              const d = await (await fetch(`${API}/api/project`)).json()
              setCurrentProject(d.current || p); setAllProjects(d.projects || [])
              setMessages([]); switchToSession(activeAgent, activeSession?.sessionId || 'default')
            } catch(_) {}
          }}
            className={`text-xs px-3 py-1 rounded-full transition-colors shrink-0 ${p === currentProject ? 'bg-violet-600/30 text-violet-300 border border-violet-500/40' : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800'}`}>
            {p.replace(/_/g, ' ')}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-1 shrink-0">
          <button onClick={()=>setShowCollab(!showCollab)} className={`text-[10px] px-2 py-1 rounded transition-colors ${showCollab ? 'bg-violet-600/20 text-violet-400' : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800'}`}>📋 Team</button>
          <button onClick={()=>setSidebarPanel('leads')} className="text-[10px] px-2 py-1 rounded text-gray-500 hover:text-gray-300 hover:bg-gray-800">📊 CRM</button>
          <button onClick={()=>setSidebarPanel('files')} className="text-[10px] px-2 py-1 rounded text-gray-500 hover:text-gray-300 hover:bg-gray-800">📁 Files</button>
          <button onClick={()=>setSidebarPanel('settings')} className="text-[10px] px-2 py-1 rounded text-gray-500 hover:text-gray-300 hover:bg-gray-800">⚙ Settings</button>
          <button onClick={async()=>{try{const r=await fetch(`${API}/api/performance`);setPerformanceData(await r.json());setShowPerformance(true)}catch(_){}}}
            className="text-[10px] px-2 py-1 rounded text-gray-500 hover:text-violet-300 hover:bg-gray-800">⚡ Perf</button>
        </div>
      </div>

      <div className="flex flex-1 min-h-0">
        {/* LEFT SIDEBAR */}
        <div className="w-56 bg-gray-900 border-r border-gray-800 flex flex-col shrink-0">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
            <h1 className="text-sm font-bold text-violet-400">AIONCLAW</h1>
          </div>
          {sidebarContent ? (
            <div className="flex-1 overflow-hidden">{sidebarContent}</div>
          ) : (
            <div className="flex-1 flex flex-col overflow-hidden">
              <div className="flex flex-wrap gap-0.5 p-2 border-b border-gray-800 overflow-y-auto max-h-[200px]">
                {agents.map(a => {
                  const isActive = activeAgent === a.id
                  const isThinking = thinkingEvents.some(e => e.agent_id === a.id && (e.status==='thinking'||e.status==='started'||e.status==='synthesizing'))
                  return (
                    <button key={a.id} onClick={()=>switchAgent(a.id)}
                      className={`px-2 py-1 text-[10px] rounded transition-colors flex items-center gap-1 ${isActive?'bg-violet-600/30 text-violet-300 border border-violet-500/30':'hover:bg-gray-800 text-gray-500 border border-transparent'} ${isThinking?'animate-pulse border-amber-500/50':''}`}>
                      {isThinking&&<span className="w-1 h-1 bg-amber-400 rounded-full"/>}
                      {a.icon}<span className="truncate max-w-[50px]">{a.name.split(' ')[0]}</span>
                    </button>
                  )
                })}
              </div>
              <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
                <button onClick={addSession}
                  className="w-full text-sm text-gray-500 hover:text-violet-400 px-3 py-2 rounded-lg border border-dashed border-gray-700 hover:border-violet-500/50 transition-colors flex items-center gap-2 mb-2">
                  <span className="text-lg leading-none">+</span><span>New Chat</span>
                </button>
                {agentSessions.map(s => {
                  const isActive = activeSession?.sessionId === s.id
                  const msgCount = messages.filter(m => m._aid===activeAgent && m._sid===s.id).length
                  return (
                    <button key={s.id} onClick={()=>switchToSession(activeAgent,s.id)}
                      className={`w-full text-left text-xs px-3 py-2 rounded-lg transition-colors flex items-center gap-2 ${isActive?'bg-violet-600/20 text-violet-300 border border-violet-500/30':'hover:bg-gray-800/60 text-gray-400 border border-transparent'}`}>
                      <span className="text-sm shrink-0">💬</span>
                      <div className="flex-1 min-w-0">
                        <div className="truncate">{s.label}</div>
                        {msgCount > 0 && <div className="text-[9px] text-gray-600">{msgCount} msgs</div>}
                      </div>
                    </button>
                  )
                })}
              </div>
              <div className="border-t border-gray-800 p-2.5">
                <div className="text-[9px] text-gray-600 mb-1.5 uppercase tracking-wider">Agent Status</div>
                <div className="flex flex-wrap gap-1">
                  {agents.map(a => {
                    const status = activeAgents[a.id]
                    const isThinking = thinkingEvents.some(e => e.agent_id === a.id && (e.status==='thinking'||e.status==='started'||e.status==='synthesizing'))
                    const dotClass = isThinking?'bg-amber-400 animate-pulse':status==='writing'?'bg-green-400 animate-pulse':status&&status!=='idle'?'bg-amber-500':'bg-gray-700'
                    return (
                      <span key={a.id} className="relative group" title={`${a.name}: ${isThinking?'working...':status||'idle'}`}>
                        <span className={`inline-block text-[10px] px-1 py-0.5 rounded ${isThinking?'bg-amber-900/30':status==='writing'?'bg-green-900/30':'bg-gray-800'}`}>
                          <span className={`inline-block w-1.5 h-1.5 rounded-full ${dotClass} mr-0.5 align-middle`}/>
                          <span className="align-middle">{a.icon}</span>
                        </span>
                      </span>
                    )
                  })}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* CHAT AREA */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Chat header */}
          <div className="flex items-center gap-3 px-6 py-2 border-b border-gray-800 bg-gray-900/50 text-xs shrink-0">
            <span className="text-lg">{currentAgent?.icon}</span>
            <div>
              <span className="text-violet-400 font-medium">{currentAgent?.name}</span>
              <span className="text-gray-600 ml-2">{agentSessions.find(s=>s.id===activeSession?.sessionId)?.label||'Chat'}</span>
            </div>
            <div className="flex items-center gap-2 ml-4">
              {currentEngine&&<span className="text-gray-500 flex items-center gap-1"><span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse"/>{engines.find(e=>e.id===currentEngine)?.name||currentEngine}</span>}
              {currentTool&&<span className="text-amber-400 text-[10px] flex items-center gap-1"><span className="w-1.5 h-1.5 bg-amber-400 rounded-full animate-pulse"/>⚡ {currentTool}...</span>}
              {typing&&<span className="text-gray-500 flex items-center gap-1"><span className="w-1.5 h-1.5 bg-violet-400 rounded-full animate-pulse"/>Generating...</span>}
              {loadingHistory&&<span className="text-gray-500">Loading...</span>}
            </div>
            <div className="ml-auto flex items-center gap-1">
              {displayMessages.length>0&&(
                <>
                  <button onClick={exportWord} className="text-gray-500 hover:text-violet-400 transition-colors px-2 py-1 rounded hover:bg-gray-800 text-[10px] flex items-center gap-1" title="Export to Word">📄 Word</button>
                  <button onClick={exportExcel} className="text-gray-500 hover:text-violet-400 transition-colors px-2 py-1 rounded hover:bg-gray-800 text-[10px] flex items-center gap-1" title="Export to Excel">📊 Excel</button>
                </>
              )}
            </div>
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
                <div className={`max-w-[80%] rounded-2xl px-4 py-3 group relative ${msg.role==='user'?'bg-violet-600 text-white':msg.role==='system'?'bg-amber-900/30 text-amber-300 text-sm border border-amber-800/50':msg.role==='error'?'bg-red-900/50 text-red-300 border border-red-800':msg.role==='tool_use'?'bg-amber-900/30 text-amber-300 text-sm border border-amber-800/50':msg.role==='tool_result'?'bg-gray-800 text-gray-400 text-xs font-mono border border-gray-700':'bg-gray-800 text-gray-100'}`}>
                  {msg.role==='system'&&<div className="whitespace-pre-wrap">{msg.content}</div>}
                  {msg.role==='tool_use'&&<><div className="font-medium mb-1 flex items-center gap-2">{currentTool===msg.name ? <span className="w-2 h-2 bg-amber-400 rounded-full animate-pulse" /> : <span className="w-2 h-2 bg-gray-600 rounded-full" />}🔧 {msg.name}{currentTool===msg.name && <span className="text-amber-400 text-[10px] animate-pulse ml-auto">executing...</span>}</div><pre className="text-xs opacity-70">{JSON.stringify(msg.args,null,1).slice(0,200)}</pre></>}
                  {msg.role==='tool_result'&&<><div className="text-gray-500 mb-1">← {msg.name}</div><div className="whitespace-pre-wrap">{msg.result}</div></>}
                  {(msg.role==='assistant'||msg.role==='user')&&<div className="whitespace-pre-wrap">{msg.content}</div>}
                  {msg.role==='error'&&<div className="whitespace-pre-wrap text-sm">{msg.content}</div>}
                  {msg.ts && (msg.role==='assistant'||msg.role==='user')&&(
                    <div className={`text-[10px] mt-1 ${msg.role==='user'?'text-violet-300/60':'text-gray-600'}`}>{new Date(msg.ts).toLocaleTimeString('el-GR', {hour:'2-digit',minute:'2-digit'})}</div>
                  )}
                  {(msg.role==='assistant'||msg.role==='user')&&(
                    <button onClick={()=>navigator.clipboard.writeText(msg.content)}
                      className="absolute -top-2 -right-2 opacity-0 group-hover:opacity-100 transition-opacity bg-gray-700 hover:bg-gray-600 rounded-full w-6 h-6 flex items-center justify-center text-xs text-gray-300" title="Copy">📋</button>
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

            {taskProgress && taskProgress.status !== 'complete' && (
              <div className="flex justify-start">
                <div className="w-full max-w-md bg-gray-800/60 rounded-xl p-3 border border-violet-800/50">
                  <div className="flex items-center gap-2 text-xs text-gray-400 mb-1.5">
                    <span className="text-sm">{agents.find(a=>a.id===taskProgress.agent_id)?.icon||'🤖'}</span>
                    <span>{taskProgress.message}</span>
                    <span className="ml-auto text-violet-400">{taskProgress.progress}%</span>
                  </div>
                  <div className="h-1.5 bg-gray-700 rounded-full overflow-hidden">
                    <div className="h-full bg-gradient-to-r from-violet-500 to-violet-400 rounded-full transition-all duration-500" style={{width:`${taskProgress.progress}%`}} />
                  </div>
                  {taskProgress.remaining_seconds > 0 && (
                    <div className="flex items-center gap-2 mt-1">
                      <div className="flex-1 h-0.5 bg-gray-700 rounded-full overflow-hidden">
                        <div className="h-full bg-violet-600 rounded-full animate-pulse" style={{width:`${Math.min(100,taskProgress.progress)}%`}}/>
                      </div>
                      <span className="text-[10px] text-violet-400 shrink-0">~{taskProgress.remaining_seconds}s remaining</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {taskProgress && taskProgress.status === 'complete' && taskProgress.duration_s && (
              <div className="flex justify-start">
                <div className="bg-gray-800/40 rounded-xl px-3 py-2 border border-green-800/30 text-xs text-gray-400 flex items-center gap-2">
                  <span>✅ {agents.find(a=>a.id===taskProgress.agent_id)?.icon} {taskProgress.agent_id}</span>
                  <span className="text-green-500">{taskProgress.duration_s}s</span>
                </div>
              </div>
            )}
          </div>

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
                  className="text-gray-500 hover:text-violet-400 transition-colors disabled:opacity-50" title="Upload file">📎</button>
                <input ref={fileInputRef} type="file" className="hidden" onChange={async (e) => {
                  const file = e.target.files?.[0]; if (!file) return
                  const form = new FormData(); form.append('file', file)
                  try {
                    const r = await fetch(`${API}/api/agents/${activeAgent}/upload`, {method:'POST', body:form})
                    if (r.ok) {
                      const d = await r.json()
                      setMessages(prev => [...prev, {role:'system', content:`📎 Ανέβηκε το αρχείο: ${d.filename}`, _aid:activeAgent, _sid:activeSession?.sessionId||'default'}])
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

        {/* RIGHT SIDEBAR - Team Activity */}
        {showCollab && (
          <div className="w-64 bg-gray-900/80 border-l border-gray-800 flex flex-col shrink-0">
            <div className="px-3 py-2 border-b border-gray-800 text-xs text-gray-500 uppercase font-medium flex items-center justify-between gap-2">
              <span>Team Activity</span>
              <div className="flex items-center gap-1">
                <button onClick={()=>{setShowProjectInput(!showProjectInput)}} className="text-gray-600 hover:text-violet-400 transition-colors text-[10px]" title="New project">✏️</button>
                <button onClick={clearCollab} className="text-gray-600 hover:text-red-400 transition-colors text-[10px]" title="Clear activity">✕</button>
              </div>
            </div>
            {showProjectInput && (
              <form onSubmit={async (e) => {
                e.preventDefault(); const name = e.target.project.value.trim(); if (!name) return
                try {
                  const r = await fetch(`${API}/api/project`, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({name})})
                  const d = await r.json()
                  if (d.current) setCurrentProject(d.current); if (d.projects) setAllProjects(d.projects)
                } catch(_) {}
                setShowProjectInput(false); setMessages([]); switchToSession(activeAgent, activeSession?.sessionId || 'default')
              }} className="flex gap-1 p-2 border-b border-gray-800">
                <input name="project" placeholder="project name..." className="flex-1 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-[10px] text-gray-100 placeholder-gray-500 focus:outline-none focus:border-violet-500"/>
              </form>
            )}

            {/* Agent Thinking section - always visible */}
            <div className="border-b border-gray-800">
              <div className="px-3 py-1.5 text-[9px] text-gray-600 uppercase tracking-wider font-medium flex items-center gap-2">
                <span>Live Activity</span>
                {thinkingEvents.some(e => e.status !== 'complete' && e.status !== 'error') && (
                  <span className="flex items-center gap-1 text-amber-400">
                    <span className="w-1.5 h-1.5 bg-amber-400 rounded-full animate-pulse"/>
                    active
                  </span>
                )}
              </div>
              <div className="px-2 py-1 space-y-1 max-h-[250px] overflow-y-auto">
                {recentThinking.length === 0 ? (
                  <div className="text-center py-4 text-gray-700 text-[10px]">Waiting for agent activity...</div>
                ) : (
                  recentThinking.map((ev, i) => agentThinks({...ev, id: ev.id||i, _ts: ev._ts||i}))
                )}
              </div>
            </div>

            <div ref={collabRef} className="flex-1 overflow-y-auto p-2 space-y-1">
              {collabEvents.length === 0 && (
                <div className="text-center py-8 text-gray-600 text-xs">No activity yet.<br/>Send a message to start collaboration.</div>
              )}
              {[...collabEvents].reverse().map((ev, ri) => {
                if (ev.type === 'agent_thinking') return null
                const isRead = readEvents.includes(ev.id)
                const fromAgent = agents.find(a => a.id === ev.from)
                const toAgent = agents.find(a => a.id === ev.to)
                return (
                  <button key={ev.id||ri} onClick={()=>{
                    if (ev.id) fetch(`${API}/api/collab/events/${ev.id}/read`, {method:'POST'}).catch(()=>{})
                    setReadEvents(prev => prev.includes(ev.id) ? prev : [...prev, ev.id])
                    if (ev.to) navigateToAgent(ev.to === 'ceo' ? ev.from : ev.to, 'default')
                  }}
                    className={`w-full text-left rounded-lg p-2 border transition-colors ${isRead ? 'bg-gray-900/30 border-gray-800/30' : 'bg-gray-800/40 border-gray-800 hover:bg-gray-700/50'}`}>
                    <div className={`flex items-center gap-1.5 mb-0.5 ${isRead ? 'opacity-40' : ''}`}>
                      <span className="text-sm">{fromAgent?.icon||'🤖'}</span>
                      <span className={`text-[10px] font-medium ${isRead ? 'text-gray-600 line-through' : 'text-gray-400'}`}>{fromAgent?.name||ev.from}{ev.to?` → ${toAgent?.name||ev.to}`:''}</span>
                      <span className={`ml-auto w-2 h-2 rounded-full ${activeAgents[ev.from]==='writing'||activeAgents[ev.to]==='writing'?'bg-green-400 animate-pulse':activeAgents[ev.from]==='has_response'?'bg-green-500':'bg-gray-600'}`} />
                    </div>
                    <div className={`text-[10px] ${isRead ? 'opacity-30 line-through text-gray-600' : ev.action === 'delegate' ? 'text-amber-300' : ev.action === 'result' ? 'text-green-300' : ev.type === 'task_progress' ? 'text-violet-300' : 'text-gray-300'}`}>
                      {ev.action === 'delegate' ? '📋 Ανάθεση' : ev.action === 'result' ? '✅ Αποτέλεσμα' : ev.type === 'task_progress' ? (ev.status==='complete'?'✅ Ολοκληρώθηκε':`🔧 ${ev.progress}%`): ev.action||ev.type}
                    </div>
                    <div className={`text-[11px] mt-0.5 line-clamp-2 ${isRead ? 'text-gray-600 line-through opacity-40' : 'text-gray-400'}`}>{ev.content||ev.thought||ev.message||''}</div>
                    <div className={`text-[9px] mt-0.5 ${isRead ? 'text-gray-700' : 'text-gray-600'}`}>{new Date(ev.ts).toLocaleTimeString('el-GR')}</div>
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </div>
      {/* BOTTOM STATUS BAR */}
      <div className="h-6 bg-gray-900 border-t border-gray-800 flex items-center px-3 gap-2 text-[10px] shrink-0 overflow-x-auto">
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${connected?'bg-green-500':'bg-red-500'}`} />
        <span className="text-gray-600 shrink-0">{wsStatus}</span>
        <div className="h-3 w-px bg-gray-800 shrink-0" />
        {thinkingEvents.some(e => e.status !== 'complete' && e.status !== 'error') && (
          <span className="text-amber-400 shrink-0 flex items-center gap-1">
            <span className="w-1.5 h-1.5 bg-amber-400 rounded-full animate-pulse"/>
            Working...
          </span>
        )}
        <div className="flex gap-1.5 overflow-x-auto">
          {agents.filter(a => {
            const t = thinkingEvents.filter(e => e.agent_id === a.id)
            return t.length > 0 && t.some(e => e.status !== 'complete' && e.status !== 'error')
          }).slice(0, 5).map(a => {
            const last = thinkingEvents.filter(e => e.agent_id === a.id).pop()
            return (
              <span key={a.id} className="flex items-center gap-1 text-gray-400 shrink-0">
                <span className="w-1 h-1 bg-amber-400 rounded-full animate-pulse"/>
                {a.icon}
                <span className="text-gray-500">{a.name.split(' ')[0]}</span>
                {last?.remaining_seconds > 0 && <span className="text-violet-500">~{last.remaining_seconds}s</span>}
              </span>
            )
          })}
        </div>
      </div>
      {perfPanel}
    </div>
  )
}

export default App
