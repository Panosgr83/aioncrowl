import { useState, useEffect, useRef, useCallback } from 'react'

const API = 'http://127.0.0.1:9790'

const CATEGORIES = {
  'Core': ['ceo'],
  'Tech': ['dev', 'analytics', 'security'],
  'Business': ['sales', 'leadfinder', 'offers', 'finance'],
  'Marketing': ['marketing', 'seo', 'imggen'],
  'Support': ['support', 'memory', 'docsagent', 'consultant'],
}

function groupToolCalls(msgs) {
  const result = []
  let i = 0
  while (i < msgs.length) {
    const msg = msgs[i]
    if (msg.role === 'assistant') {
      const tools = []
      let j = i + 1
      while (j < msgs.length &&
             (msgs[j].role === 'tool_use' || msgs[j].role === 'tool_result')) {
        if (msgs[j].role === 'tool_use') {
          const resultMsg = msgs[j+1]?.role === 'tool_result' ? msgs[j+1] : null
          const duration = resultMsg && msgs[j].ts && resultMsg.ts
            ? ((new Date(resultMsg.ts) - new Date(msgs[j].ts)) / 1000).toFixed(1)
            : null
          tools.push({
            name: msgs[j].name,
            args: msgs[j].args,
            result: resultMsg?.result,
            duration
          })
          if (resultMsg) j++
        }
        j++
      }
      const dvals = tools.map(t => parseFloat(t.duration)||0).filter(d => d>0)
      const total = dvals.length > 1 ? Math.max(...dvals).toFixed(1) : (dvals[0]?.toFixed(1) || null)
      result.push({ ...msg, tools, _grouped: true, _totalDuration: total })
      i = j
    } else {
      result.push(msg)
      i++
    }
  }
  return result
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
  const [currentTool, setCurrentTool] = useState(null)
  const [performanceData, setPerformanceData] = useState(null)
  const [showPerformance, setShowPerformance] = useState(false)
  const [showActivity, setShowActivity] = useState(false)
  const [activityLog, setActivityLog] = useState([])
  const [showCollab, setShowCollab] = useState(true)
  const [thinkingEvents, setThinkingEvents] = useState([])
  const [compactView, setCompactView] = useState(false)
  const [showKnowledge, setShowKnowledge] = useState(false)
  const [kbStats, setKbStats] = useState(null)
  const [kbQuery, setKbQuery] = useState('')
  const [kbResults, setKbResults] = useState([])
  const [kbTab, setKbTab] = useState('browse')
  const [schedulerJobs, setSchedulerJobs] = useState([])
  const [schedName, setSchedName] = useState('')
  const [schedAgentId, setSchedAgentId] = useState('analytics')
  const [schedTask, setSchedTask] = useState('')
  const [schedInterval, setSchedInterval] = useState(60)

  const [collapsedCategories, setCollapsedCategories] = useState({})
  const [expandedTools, setExpandedTools] = useState({})

  const fileInputRef = useRef(null)
  const kbFileRef = useRef(null)
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
  const displayMessages = groupToolCalls(messages.filter(m =>
    m._aid === activeAgent && m._sid === (activeSession?.sessionId || 'default')
  ))
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
    setMessages(prev => [...prev, {role:'system',content:`📝 Συμπληρωματική πληροφορία: ${it}`,ts:new Date().toISOString(),_aid:aid,_sid:sid,_sysType:'info'}])
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
                return [...prev, {role:'system', content:`⏳ ${a?.icon||''} ${a?.name||data.agent_id} ξεκινά εργασία... (εκτίμ. ${data.estimated_seconds||'?'}s)`, _aid: activeAgentRef.current, _sid: pendingRef.current.sessionId||'default', ts: new Date().toISOString(), _sysType: 'thinking'}]
              })
            }
            if (data.status === 'complete' && data.agent_id !== activeAgentRef.current) {
              const a = agents.find(x => x.id === data.agent_id)
              setMessages(prev => [...prev, {role:'system', content:`✅ ${a?.icon||''} ${a?.name||data.agent_id} ολοκλήρωσε σε ${data.duration_s||'?'}s`, _aid: activeAgentRef.current, _sid: pendingRef.current.sessionId||'default', ts: new Date().toISOString(), _sysType: 'info'}])
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

  const activityPanel = showActivity ? (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center" onClick={()=>setShowActivity(false)}>
      <div className="bg-gray-900 border border-gray-700 rounded-xl max-w-2xl w-full mx-4 max-h-[80vh] overflow-y-auto" onClick={e=>e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700 sticky top-0 bg-gray-900">
          <span className="text-xs font-medium text-emerald-400">📋 Audit Trail</span>
          <button onClick={()=>setShowActivity(false)} className="text-gray-500 hover:text-gray-300 text-xs">✕</button>
        </div>
        <div className="p-2 text-xs">
          {activityLog.length === 0 ? (
            <div className="text-center py-8 text-gray-600">No activity recorded yet</div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="text-[9px] text-gray-600 uppercase border-b border-gray-800">
                  <th className="text-left py-2 px-2">Time</th>
                  <th className="text-left py-2 px-2">Agent</th>
                  <th className="text-left py-2 px-2">Tool</th>
                  <th className="text-left py-2 px-2">Args</th>
                  <th className="text-left py-2 px-2">Result</th>
                  <th className="text-center py-2 px-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {[...activityLog].reverse().map((e,i) => (
                  <tr key={i} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                    <td className="py-1.5 px-2 text-[9px] text-gray-500 whitespace-nowrap font-mono">{e.ts?.slice(11,19)}</td>
                    <td className="py-1.5 px-2 text-[10px] text-gray-300">{e.agent}</td>
                    <td className="py-1.5 px-2 text-[10px] text-violet-400">{e.tool}</td>
                    <td className="py-1.5 px-2 text-[9px] text-gray-500 max-w-[160px] truncate">{e.args}</td>
                    <td className="py-1.5 px-2 text-[9px] text-gray-500 max-w-[200px] truncate">{e.result}</td>
                    <td className="py-1.5 px-2 text-center">{e.success ? <span className="text-green-500 text-[10px]">✓</span> : <span className="text-red-500 text-[10px]">✗</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="px-4 py-3 border-t border-gray-700 flex gap-2">
          <button onClick={async()=>{try{const r=await fetch(`${API}/api/activity`);const d=await r.json();setActivityLog(d.entries||[])}catch(_){}}}
            className="text-[10px] text-gray-500 hover:text-gray-300">Refresh</button>
          <button onClick={()=>setShowActivity(false)}
            className="text-[10px] text-emerald-400 hover:text-emerald-300 ml-auto">Close</button>
        </div>
      </div>
    </div>
  ) : null

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

  const knowledgePanel = showKnowledge ? (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center" onClick={()=>setShowKnowledge(false)}>
      <div className="bg-gray-900 border border-gray-700 rounded-xl max-w-2xl w-full mx-4 max-h-[80vh] overflow-y-auto" onClick={e=>e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700 sticky top-0 bg-gray-900">
          <span className="text-xs font-medium text-amber-400">🧠 Knowledge Base</span>
          <button onClick={()=>setShowKnowledge(false)} className="text-gray-500 hover:text-gray-300 text-xs">✕</button>
        </div>
        <div className="flex border-b border-gray-800 text-xs">
          {['browse','search','upload','schedule'].map(tab=>(
            <button key={tab} onClick={()=>{setKbTab(tab);if(tab==='schedule')fetchSchedulerJobs()}}
              className={`px-4 py-2 ${kbTab===tab?'text-amber-400 border-b border-amber-400':'text-gray-500 hover:text-gray-300'}`}>
              {tab==='browse'?'📚 Browse':tab==='search'?'🔍 Search':tab==='upload'?'📤 Upload':'⏰ Schedule'}
            </button>
          ))}
        </div>
        {kbTab === 'browse' && (
          <div className="p-4 text-xs">
            <div className="flex justify-between items-center mb-3">
              <span className="text-gray-400">Project: <span className="text-amber-400">{currentProject}</span> ({kbStats?.project_chunks||0} chunks)</span>
              <span className="text-gray-500">Global: {kbStats?.global_chunks||0} chunks</span>
            </div>
            {(!kbStats?.sources||kbStats.sources.length===0) ? (
              <div className="text-center py-8 text-gray-600">No indexed documents. Write files or upload to populate.</div>
            ) : (
              <div className="space-y-2">
                {kbStats.sources.map((src,i)=>(
                  <div key={i} className="flex items-center justify-between bg-gray-800/50 rounded px-3 py-2">
                    <span className="text-gray-300">📄 {src}</span>
                    <span className="text-gray-600 text-[9px]">indexed</span>
                  </div>
                ))}
              </div>
            )}
            <div className="mt-4">
              <button onClick={async()=>{try{const r=await fetch(`${API}/api/knowledge/stats?project=${currentProject}`);setKbStats(await r.json())}catch(_){}}}
                className="text-[10px] text-gray-500 hover:text-gray-300">↻ Refresh</button>
            </div>
          </div>
        )}
        {kbTab === 'search' && (
          <div className="p-4 text-xs">
            <div className="flex gap-2 mb-3">
              <input value={kbQuery} onChange={e=>setKbQuery(e.target.value)}
                onKeyDown={async e=>{if(e.key==='Enter'){try{const r=await fetch(`${API}/api/knowledge/query`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({query:kbQuery,project:currentProject})});const d=await r.json();setKbResults(d.results||[])}catch(_){}}}}
                placeholder="Search knowledge base..."
                className="flex-1 bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-gray-300 focus:outline-none focus:border-amber-500 text-[11px]"/>
              <button onClick={async()=>{try{const r=await fetch(`${API}/api/knowledge/query`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({query:kbQuery,project:currentProject})});const d=await r.json();setKbResults(d.results||[])}catch(_){}}}
                className="text-[10px] px-3 py-1.5 bg-amber-600/20 text-amber-400 rounded hover:bg-amber-600/30">Search</button>
            </div>
            {kbResults.length===0 ? (
              <div className="text-center py-8 text-gray-600">{kbQuery?'No results':'Enter a query and press Search'}</div>
            ) : (
              <div className="space-y-3">
                {kbResults.map((r,i)=>(
                  <div key={i} className="bg-gray-800/50 rounded p-3 border border-gray-700/50">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-amber-400">{r.metadata?.source||r.metadata?.path?.split('/').pop()||'unknown'}</span>
                      <span className="text-gray-600 text-[9px]">{r.collection==='global_kb'?'📦 global':'🌐 '+currentProject} · score: {r.score?.toFixed(3)}</span>
                    </div>
                    <div className="text-gray-300 font-mono text-[10px] leading-relaxed line-clamp-3">{r.content}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        {kbTab === 'upload' && (
          <div className="p-4 text-xs">
            <div className="border-2 border-dashed border-gray-700 rounded-lg p-8 text-center hover:border-amber-500/50 transition-colors cursor-pointer"
              onClick={()=>kbFileRef.current?.click()}
              onDragOver={e=>{e.preventDefault();e.currentTarget.classList.add('border-amber-500')}}
              onDragLeave={e=>{e.currentTarget.classList.remove('border-amber-500')}}
              onDrop={async e=>{e.preventDefault();e.currentTarget.classList.remove('border-amber-500');const file=e.dataTransfer.files[0];if(file){await uploadKbFile(file)}}}>
              <div className="text-3xl mb-2">📤</div>
              <div className="text-gray-400 mb-1">Drop file here or click to browse</div>
              <div className="text-gray-600 text-[9px]">.md .txt .json .py .js .html .css .csv</div>
              <input ref={kbFileRef} type="file" accept=".md,.txt,.json,.py,.js,.jsx,.ts,.tsx,.html,.css,.csv,.yml,.yaml,.xml,.ini,.cfg" className="hidden"
                onChange={async e=>{const file=e.target.files[0];if(file){await uploadKbFile(file);e.target.value=''}}}/>
            </div>
            <div className="mt-3 text-gray-500 text-[9px]">Uploaded text files are auto-indexed into the current project KB. Agents can then search them with query_kb.</div>
          </div>
        )}
        {kbTab === 'schedule' && (
          <div className="p-4 text-xs">
            <div className="grid grid-cols-4 gap-2 mb-3">
              <input value={schedName} onChange={e=>setSchedName(e.target.value)} placeholder="Job name"
                className="bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-gray-300 focus:outline-none focus:border-amber-500 text-[10px]"/>
              <select value={schedAgentId} onChange={e=>setSchedAgentId(e.target.value)}
                className="bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-gray-300 text-[10px]">
                {agents.filter(a=>a.id!=='ceo').map(a=>(<option key={a.id} value={a.id}>{a.icon} {a.id}</option>))}
              </select>
              <input type="number" value={schedInterval} onChange={e=>setSchedInterval(Number(e.target.value)||60)} placeholder="Min"
                className="bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-gray-300 w-16 text-[10px]"/>
              <button onClick={async()=>{if(!schedName||!schedTask)return;try{const r=await fetch(`${API}/api/scheduler/add`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:schedName,agent_id:schedAgentId,task:schedTask,interval_minutes:schedInterval,project:currentProject})});await r.json();setSchedName('');setSchedTask('');fetchSchedulerJobs()}catch(_){}}}
                className="text-[10px] px-2 py-1.5 bg-amber-600/20 text-amber-400 rounded hover:bg-amber-600/30">Add</button>
            </div>
            <textarea value={schedTask} onChange={e=>setSchedTask(e.target.value)} placeholder="Task description (what the agent should do)"
              className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-gray-300 focus:outline-none focus:border-amber-500 text-[10px] h-16 resize-none mb-3"/>
            <div className="text-gray-500 text-[9px] mb-2">{schedulerJobs.length} jobs · Refreshes every interval</div>
            {schedulerJobs.length===0 ? (
              <div className="text-center py-4 text-gray-600">No scheduled jobs</div>
            ) : (
              <div className="space-y-2 max-h-60 overflow-y-auto">
                {schedulerJobs.map(j=>(
                  <div key={j.id} className="bg-gray-800/50 rounded px-3 py-2 flex items-center justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="text-gray-300 text-[10px] truncate">{j.name}</div>
                      <div className="text-gray-500 text-[9px]">{j.agent_id} · every {j.interval_minutes}m · {j.run_count||0} runs</div>
                      {j.last_run && <div className="text-gray-600 text-[8px]">last: {j.last_run?.slice(0,16)}</div>}
                    </div>
                    <div className="flex gap-1 shrink-0 ml-2">
                      <button onClick={async()=>{await fetch(`${API}/api/scheduler/${j.id}/run`,{method:'POST'});fetchSchedulerJobs()}}
                        className="text-[9px] text-emerald-400 hover:text-emerald-300">▶</button>
                      <button onClick={async()=>{await fetch(`${API}/api/scheduler/${j.id}/toggle`,{method:'POST'});fetchSchedulerJobs()}}
                        className={`text-[9px] ${j.enabled?'text-amber-400':'text-gray-600'} hover:text-amber-300`}>{j.enabled?'⏸':'▶'}</button>
                      <button onClick={async()=>{await fetch(`${API}/api/scheduler/${j.id}`,{method:'DELETE'});fetchSchedulerJobs()}}
                        className="text-[9px] text-red-400 hover:text-red-300">✕</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  ) : null

  const fetchSchedulerJobs = async () => {
    try { const r = await fetch(`${API}/api/scheduler/jobs`); const d = await r.json(); setSchedulerJobs(d.jobs||[]); } catch(_) {}
  }

  const uploadKbFile = async (file) => {
    try {
      const form = new FormData()
      form.append('file', file)
      await fetch(`${API}/api/agents/${activeAgent}/upload`, {method:'POST',body:form})
      const r = await fetch(`${API}/api/knowledge/stats?project=${currentProject}`)
      setKbStats(await r.json())
    } catch(_) {}
  }

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
    <div className="h-screen flex flex-col bg-app-base text-text-primary font-sans overflow-hidden">
      {/* TOP PROJECT BAR */}
      <div className="flex items-center gap-1 px-4 py-1.5 bg-app-surface border-b border-app-elevated shrink-0 overflow-x-auto z-10">
        <span className="text-violet-400 font-bold text-sm mr-2 shrink-0">AIONCLAW</span>
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${connected?'bg-green-500 animate-pulse':'bg-red-500'}`} />
        <div className="h-4 w-px bg-app-elevated mx-2 shrink-0" />
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
          <button onClick={async()=>{try{const r=await fetch(`${API}/api/activity`);const d=await r.json();setActivityLog(d.entries||[]);setShowActivity(true)}catch(_){}}}
            className="text-[10px] px-2 py-1 rounded text-gray-500 hover:text-emerald-300 hover:bg-gray-800">📋 Activity</button>
          <button onClick={async()=>{try{const r=await fetch(`${API}/api/knowledge/stats?project=${currentProject}`);setKbStats(await r.json());setKbTab('browse');setShowKnowledge(true)}catch(_){}}}
            className="text-[10px] px-2 py-1 rounded text-gray-500 hover:text-amber-300 hover:bg-gray-800">🧠 KB</button>
        </div>
      </div>

      <div className="flex flex-1 min-h-0">
        {/* LEFT SIDEBAR */}
        <div className="w-56 bg-app-surface border-r border-app-elevated flex flex-col shrink-0">
          <div className="flex items-center justify-between px-4 py-3 border-b border-app-elevated">
            <h1 className="text-sm font-bold text-accent">AIONCLAW</h1>
          </div>
          {sidebarContent ? (
            <div className="flex-1 overflow-hidden">{sidebarContent}</div>
          ) : (
            <div className="flex-1 flex flex-col overflow-hidden">
              <div className="flex-1 overflow-y-auto p-2 space-y-3">
                {Object.entries(CATEGORIES).map(([cat, agentIds]) => {
                  const catAgents = agents.filter(a => agentIds.includes(a.id))
                  if (catAgents.length === 0) return null
                  const hasActive = catAgents.some(a => a.id === activeAgent)
                  const expanded = !collapsedCategories[cat]
                  return (
                    <div key={cat} className="space-y-0.5">
                      <button onClick={() => setCollapsedCategories(prev => ({...prev, [cat]: !prev[cat]}))}
                        className={`w-full flex items-center gap-1 px-2 text-[9px] uppercase tracking-wider font-medium transition-colors ${hasActive ? 'text-accent' : 'text-text-dim hover:text-text-secondary'}`}>
                        <span className="text-[8px]">{expanded ? '▾' : '▸'}</span>{cat}
                      </button>
                      {expanded && catAgents.map(a => {
                        const isActive = activeAgent === a.id
                        const isThinking = thinkingEvents.some(e => e.agent_id === a.id && (e.status==='thinking'||e.status==='started'||e.status==='synthesizing'))
                        return (
                          <button key={a.id} onClick={()=>switchAgent(a.id)}
                            className={`w-full text-left px-3 py-1.5 text-[11px] rounded transition-all flex items-center gap-2 ${isActive ? 'border-l-2 border-accent bg-accent/10 text-text-primary' : 'text-text-secondary hover:bg-app-elevated border-l-2 border-transparent'} ${isThinking ? 'animate-pulse' : ''}`}>
                            {isThinking && <span className="w-1.5 h-1.5 bg-accent rounded-full animate-pulse shrink-0"/>}
                            <span className="shrink-0">{a.icon}</span>
                            <span className="truncate">{a.name}</span>
                            {isActive && <span className="w-1 h-1 bg-accent rounded-full ml-auto shrink-0"/>}
                          </button>
                        )
                      })}
                    </div>
                  )
                })}
                {agents.filter(a => !Object.values(CATEGORIES).flat().includes(a.id)).map(a => {
                  const isActive = activeAgent === a.id
                  return (
                    <button key={a.id} onClick={()=>switchAgent(a.id)}
                      className={`w-full text-left px-3 py-1.5 text-[11px] rounded transition-all flex items-center gap-2 ${isActive ? 'border-l-2 border-accent bg-accent/10 text-text-primary' : 'text-text-secondary hover:bg-app-elevated border-l-2 border-transparent'}`}>
                      <span className="shrink-0">{a.icon}</span>
                      <span className="truncate">{a.name}</span>
                    </button>
                  )
                })}
              </div>
              <div className="px-2 py-1 border-t border-app-elevated">
                <button onClick={addSession}
                  className="w-full text-xs text-text-secondary hover:text-accent px-3 py-2 rounded-lg border border-dashed border-app-elevated hover:border-accent/40 transition-colors flex items-center gap-2">
                  <span className="text-sm leading-none">+</span><span>New Chat</span>
                </button>
              </div>
              {/* Session tabs */}
              <div className="max-h-[200px] overflow-y-auto px-2 pb-2 space-y-0.5">
                {agentSessions.map(s => {
                  const isActive = activeSession?.sessionId === s.id
                  const msgCount = messages.filter(m => m._aid===activeAgent && m._sid===s.id).length
                  return (
                    <button key={s.id} onClick={()=>switchToSession(activeAgent,s.id)}
                      className={`w-full text-left text-[11px] px-3 py-1.5 rounded transition-all flex items-center gap-2 ${isActive ? 'bg-accent/10 text-text-primary border-l-2 border-accent' : 'text-text-secondary hover:bg-app-elevated border-l-2 border-transparent'}`}>
                      <span className="text-sm shrink-0">💬</span>
                      <div className="flex-1 min-w-0">
                        <div className="truncate">{s.label}</div>
                        {msgCount > 0 && <div className="text-[9px] text-text-dim">{msgCount} msgs</div>}
                      </div>
                    </button>
                  )
                })}
              </div>
              <div className="border-t border-app-elevated p-2.5">
                <div className="text-[9px] text-text-dim mb-1.5 uppercase tracking-wider">Agent Status</div>
                <div className="flex flex-wrap gap-1">
                  {agents.map(a => {
                    const status = activeAgents[a.id]
                    const isThinking = thinkingEvents.some(e => e.agent_id === a.id && (e.status==='thinking'||e.status==='started'||e.status==='synthesizing'))
                    const dotClass = isThinking?'bg-accent animate-pulse':status==='writing'?'bg-success animate-pulse':status&&status!=='idle'?'bg-warning':'bg-text-dim'
                    return (
                      <span key={a.id} className="relative group" title={`${a.name}: ${isThinking?'working...':status||'idle'}`}>
                        <span className={`inline-block text-[10px] px-1 py-0.5 rounded ${isThinking?'bg-accent/10':status==='writing'?'bg-success/10':'bg-app-elevated'}`}>
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

            {displayMessages.map((msg,i)=>msg?(
              <div key={i} className={`flex ${msg.role==='user'?'justify-end':msg.role==='system'?'justify-center':'justify-start'}`}>
                <div className={`max-w-[80%] rounded-2xl px-4 py-3 group relative ${msg.role==='user'?'bg-gradient-to-r from-indigo-600 to-indigo-500 text-white shadow-lg shadow-indigo-500/20':msg.role==='system'?msg._sysType==='thinking'?'bg-accent/5 text-accent/70 text-[10px] rounded-full px-4 py-1 border border-accent/10':msg._sysType==='warning'?'bg-warning/10 text-warning text-[10px] rounded-full px-3 py-1 border border-warning/30':'bg-transparent text-text-dim text-[10px]':msg.role==='error'?'bg-red-900/50 text-red-300 border border-red-800':msg.role==='tool_use'?'bg-amber-900/30 text-amber-300 text-sm border border-amber-800/50':msg.role==='tool_result'?'bg-app-surface text-text-secondary text-xs font-mono border border-app-elevated':'bg-app-surface text-text-primary border-l-2 border-accent'}`}>
                  {msg.role==='system'&&<div className={`whitespace-pre-wrap ${msg._sysType==='thinking'?'text-accent/70':msg._sysType==='warning'?'text-warning':'text-text-dim italic'}`}>{msg.content}</div>}
                  {msg.role==='tool_use'&&<><div className="font-medium mb-1 flex items-center gap-2">{currentTool===msg.name ? <span className="w-2 h-2 bg-warning rounded-full animate-pulse" /> : <span className="w-2 h-2 bg-text-dim rounded-full" />}🔧 {msg.name}{currentTool===msg.name && <span className="text-warning text-[10px] animate-pulse ml-auto">executing...</span>}</div><pre className="text-xs opacity-70">{JSON.stringify(msg.args,null,1).slice(0,200)}</pre></>}
                  {msg.role==='tool_result'&&<><div className="text-text-dim mb-1">← {msg.name}</div><div className="whitespace-pre-wrap">{msg.result}</div></>}
                  {(msg.role==='assistant'||msg.role==='user')&&<div className="whitespace-pre-wrap">{msg.content}</div>}
                  {msg._grouped && msg.tools?.length > 0 && (
                    <div className="mt-3 pt-2 border-t border-app-elevated">
                      <button onClick={() => setExpandedTools(prev => ({...prev, [i]: !prev[i]}))}
                        className="flex items-center gap-1.5 text-[10px] text-text-dim hover:text-text-secondary transition-colors w-full text-left">
                        <span className="text-[8px]">{expandedTools[i] ? '▾' : '▸'}</span>
                        {msg.tools.length === 1
                          ? <><span className="text-warning">{msg.tools[0].name}</span> · <span className="font-mono text-[9px]">{msg.tools[0].duration}s</span></>
                          : <>{msg.tools.length} tools · <span className="font-mono text-[9px]">{msg._totalDuration}s</span></>}
                      </button>
                      {expandedTools[i] && (
                        <div className="mt-2 space-y-1.5">
                          {msg.tools.map((t,j) => (
                            <div key={j} className="bg-app-elevated rounded-lg px-3 py-2 text-xs">
                              <div className="flex items-center gap-2 text-text-secondary mb-0.5">
                                <span>🔧</span>
                                <span className="text-warning font-medium">{t.name}</span>
                                {t.duration && <span className="font-mono text-[9px] text-text-dim ml-auto">{t.duration}s</span>}
                              </div>
                              {t.args && <div className="text-text-dim text-[9px] font-mono truncate">{JSON.stringify(t.args).slice(0,120)}</div>}
                              {t.result && <div className="text-text-dim text-[9px] mt-0.5 line-clamp-2 font-mono">{t.result.slice(0,200)}</div>}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                  {msg.role==='error'&&<div className="whitespace-pre-wrap text-sm">{msg.content}</div>}
                  {msg.ts && (msg.role==='assistant'||msg.role==='user')&&(
                    <div className={`text-[10px] mt-1 ${msg.role==='user'?'text-indigo-300/60':'text-text-dim'}`}>{new Date(msg.ts).toLocaleTimeString('el-GR', {hour:'2-digit',minute:'2-digit'})}</div>
                  )}
                  {(msg.role==='assistant'||msg.role==='user')&&(
                    <button onClick={()=>navigator.clipboard.writeText(msg.content)}
                      className="absolute -top-2 -right-2 opacity-0 group-hover:opacity-100 transition-opacity bg-app-elevated hover:bg-accent/20 rounded-full w-6 h-6 flex items-center justify-center text-xs text-text-secondary" title="Copy">📋</button>
                  )}
                </div>
              </div>
            ):null)}

            {showInfoInput&&(
              <div className="flex justify-center">
                <div className="w-full max-w-lg bg-app-surface border border-accent/30 rounded-xl p-4 space-y-3">
                  <div className="text-xs text-accent font-medium">📝 Συμπλήρωσε επιπλέον πληροφορίες:</div>
                  <textarea ref={infoInputRef} value={infoInput} onChange={e=>setInfoInput(e.target.value)} onKeyDown={handleInfoKeyDown} rows={3}
                    placeholder="Γράψε επιπλέον στοιχεία..."
                    className="w-full bg-app-elevated border border-app-elevated rounded-lg px-3 py-2 text-sm text-text-primary placeholder-text-dim focus:outline-none focus:border-accent resize-none"
                  />
                  <div className="flex gap-2 justify-end">
                    <button onClick={()=>{setShowInfoInput(false);setInfoInput('')}} className="text-xs text-text-dim hover:text-text-secondary px-3 py-1.5">Cancel</button>
                    <button onClick={submitInfo} disabled={!infoInput.trim()} className="text-xs bg-accent hover:bg-accent-dim disabled:bg-app-elevated text-white px-4 py-1.5 rounded-full transition-all">Continue</button>
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
            <div className="border-t border-warning/30 bg-warning/5 p-3">
              {pendingApprovals.map(req => (
                <div key={req.id || req.request_id} className="flex items-center gap-3 max-w-4xl mx-auto text-sm">
                  <span className="text-warning font-medium shrink-0">⏳ Αίτημα Έγκρισης</span>
                  <span className="text-text-secondary truncate flex-1">{req.summary || req.details?.slice(0,100)}</span>
                  <button onClick={() => approveRequest(req, 'approve')}
                    className="bg-success hover:bg-success/80 text-white rounded-full px-3 py-1 text-xs font-medium transition-colors shrink-0">✓ Έγκριση</button>
                  <button onClick={() => approveRequest(req, 'reject')}
                    className="bg-error/30 hover:bg-error/50 text-white rounded-full px-3 py-1 text-xs font-medium transition-colors shrink-0">✗ Απόρριψη</button>
                </div>
              ))}
            </div>
          )}

          <div className="border-t border-app-elevated p-4 bg-app-surface/50">
            <div className="flex gap-2 max-w-4xl mx-auto">
              <div className="flex-1 flex gap-2 items-center bg-app-elevated border border-app-elevated rounded-full px-5 focus-within:border-accent focus-within:shadow-[0_0_0_2px_var(--accent-glow)] transition-all">
                <input value={input} onChange={e=>setInput(e.target.value)} onKeyDown={handleKeyDown}
                  placeholder={connected?`Μήνυμα στον ${currentAgent?.name}...`:'Connecting...'}
                  disabled={!connected||typing}
                  className="flex-1 py-3 bg-transparent text-text-primary placeholder-text-dim focus:outline-none disabled:opacity-40"
                />
                <button onClick={() => fileInputRef.current?.click()} disabled={typing}
                  className="text-text-dim hover:text-accent transition-colors disabled:opacity-40" title="Upload file">📎</button>
                <input ref={fileInputRef} type="file" className="hidden" onChange={async (e) => {
                  const file = e.target.files?.[0]; if (!file) return
                  const form = new FormData(); form.append('file', file)
                  try {
                    const r = await fetch(`${API}/api/agents/${activeAgent}/upload`, {method:'POST', body:form})
                    if (r.ok) {
                      const d = await r.json()
                      setMessages(prev => [...prev, {role:'system', content:`📎 Ανέβηκε το αρχείο: ${d.filename}`, _aid:activeAgent, _sid:activeSession?.sessionId||'default', _sysType:'info'}])
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
                  <button onClick={addInfo} className="bg-accent/10 hover:bg-accent/20 text-accent rounded-full px-4 font-medium transition-all flex items-center gap-1.5 text-sm"><span>✏️</span> Info</button>
                  <button onClick={stopGeneration} className="bg-error/10 hover:bg-error/20 text-error rounded-full px-4 font-medium transition-all flex items-center gap-1.5 text-sm"><span>■</span> Stop</button>
                </>
              ) : (
                <button onClick={()=>sendMessageFn(input)} disabled={!connected||!input.trim()}
                  className="bg-accent hover:bg-accent-dim disabled:bg-app-elevated text-white rounded-full px-6 font-medium transition-all disabled:text-text-dim">Send</button>
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
      {activityPanel}
      {perfPanel}
      {knowledgePanel}
    </div>
  )
}

export default App
