import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import SettingsPanel from './components/SettingsPanel'
import FileBrowser from './components/FileBrowser'
import LeadsPanel from './components/LeadsPanel'

const API = 'http://127.0.0.1:9790'

function renderMd(text) {
  if (!text) return ''
  let h = text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
  h = h.replace(/```(\w*)\n?([\s\S]*?)```/g, '<pre><code>$2</code></pre>')
  h = h.replace(/`([^`]+)`/g, '<code>$1</code>')
  h = h.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  h = h.replace(/\*([^*]+)\*/g, '<em>$1</em>')
  h = h.replace(/\n/g, '<br>')
  return h
}

function fmtTs(ts) {
  try {
    const d = new Date(ts)
    return d.toLocaleDateString('el-GR', {day:'2-digit',month:'2-digit',year:'numeric'})
      + ' | ' + d.toLocaleTimeString('el-GR', {hour:'2-digit',minute:'2-digit',second:'2-digit'})
  } catch { return ts || '' }
}

function fmtTime(ts) {
  try {
    return new Date(ts).toLocaleTimeString('el-GR', {hour:'2-digit',minute:'2-digit',second:'2-digit'})
  } catch { return '' }
}

const CATEGORIES = {
  'Core': ['ceo', 'pm'],
  'Tech': ['dev', 'analytics', 'security'],
  'Business': ['sales', 'leadfinder', 'offers', 'finance'],
  'Marketing': ['marketing', 'seo', 'content', 'imggen'],
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
  const [readEvents, setReadEvents] = useState([])
  const [taskProgress, setTaskProgress] = useState(null)
  const [currentProject, setCurrentProject] = useState('default')
  const [allProjects, setAllProjects] = useState(['default'])
  const [showProjectInput, setShowProjectInput] = useState(false)
  const [currentTool, setCurrentTool] = useState(null)
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
  const [copiedIndex, setCopiedIndex] = useState(null)

  const [collapsedCategories, setCollapsedCategories] = useState({})
  const [expandedTools, setExpandedTools] = useState({})
  const [drawerTab, setDrawerTab] = useState('activity')
  const [showConsole, setShowConsole] = useState(false)
  const [commEvents, setCommEvents] = useState([])
  const [agentPerf, setAgentPerf] = useState({})
  const [consoleTab, setConsoleTab] = useState('activity')
  const [lastSeenPerAgent, setLastSeenPerAgent] = useState({})
  const [liveEvents, setLiveEvents] = useState([])
  const liveRef = useRef([])
  useEffect(() => { liveRef.current = liveEvents }, [liveEvents])

  // ── New state for engine strip, health, agent sidebar, notifications ──
  const [allEngines, setAllEngines] = useState([])
  const [healthOk, setHealthOk] = useState(false)
  const [showAgentSidebar, setShowAgentSidebar] = useState(false)
  const [toasts, setToasts] = useState([])
  const [selectedAgentDetail, setSelectedAgentDetail] = useState(null)
  const toastIdRef = useRef(0)
  const [autoMode, setAutoMode] = useState(false)
  const autoModeRef = useRef(false)
  const autoTimerRef = useRef(null)
  const autoPromptRef = useRef('')

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
  const messagesRef = useRef(messages)
  useEffect(() => { messagesRef.current = messages }, [messages])

  const saveMessages = useCallback(async (fullKey, msgs) => {
    try {
      await fetch(`${API}/api/sessions/${encodeURIComponent(fullKey)}/save`, {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({messages: msgs})
      })
    } catch (e) {}
  }, [])

  const debounceRef = useRef(null)
  const debouncedSave = useCallback((fullKey, msgs) => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => saveMessages(fullKey, msgs), 500)
  }, [saveMessages])

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
  const displayMessages = useMemo(() => groupToolCalls(messages.filter(m =>
    m._aid === activeAgent && m._sid === (activeSession?.sessionId || 'default')
  )), [messages, activeAgent, activeSession])
  const recentThinking = useMemo(() => thinkingEvents.slice(-5).reverse(), [thinkingEvents])
  const hasActiveAgents = thinkingEvents.some(e => e.status === 'started' || e.status === 'thinking' || e.status === 'synthesizing')

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
    setMessages(prev => {
      const updated = [...prev, {role:'user', content:text, _aid:aid, _sid:sid, ts:new Date().toISOString()}]
      debouncedSave(`${aid}:${sid}`, updated.filter(m => m._aid===aid && m._sid===sid))
      return updated
    })
    setInput(''); setTyping(true); setCurrentEngine(''); setCurrentTool(null)
    wsRef.current.send(JSON.stringify({session_id:`${aid}:${sid}`,message:text,engine_id:selectedEngine,agent_id:aid,tools_enabled:true}))
  }, [activeAgent, activeSession, selectedEngine])
  const sendMessageRef = useRef(sendMessageFn)

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
        case 'tool_start':
          setMessages(prev=>[...prev,{role:'tool_use',name:data.name,args:data.args,_aid:aid,_sid:sid}]); setCurrentTool(data.name)
          setLiveEvents(prev => [...prev, {_liveType:'tool_exec', content:`🔧 ${data.name}`, ts:data.ts||new Date().toISOString(), agent_id:aid}].slice(-100))
          break
        case 'tool_result':
          setMessages(prev=>[...prev,{role:'tool_result',name:data.name,result:data.result,_aid:aid,_sid:sid}]); setCurrentTool(null)
          setLiveEvents(prev => [...prev, {_liveType:'tool_exec', content:`✅ ${data.name} done`, ts:data.ts||new Date().toISOString(), agent_id:aid}].slice(-100))
          break
        case 'status': setCurrentEngine(data.engine);
          setLiveEvents(prev => [...prev, {_liveType:'engine_call', content:`⚡ ${data.engine}`, ts:new Date().toISOString(), agent_id:aid, engine_id:data.engine}].slice(-100))
          break
        case 'done':
          setTyping(false); setCurrentEngine(''); setCurrentTool(null)
          setAgentHighlights(prev=>({...prev,[aid]:Date.now()}))
          setMessages(prev => {
            const targetMsgs = prev.filter(m => m._aid===aid && m._sid===sid)
            if (targetMsgs.length > 0) debouncedSave(`${aid}:${sid}`, targetMsgs)
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
    fetch(`${API}/api/agent-perf`).then(r=>r.json()).then(d => {
      if (d.stats) setAgentPerf(d.stats)
    }).catch(()=>{})
    fetch(`${API}/api/comm-log`).then(r=>r.json()).then(d => {
      if (d.entries?.length) setCommEvents(d.entries)
    }).catch(()=>{})
  }, [])

  // Auto-mode: when agent finishes, send autonomous continuation prompt
  useEffect(() => {
    if (!autoMode) return
    const lastMsg = messages[messages.length - 1]
    if (lastMsg?.role === 'assistant' && lastMsg._aid === activeAgent && !typing && !hasActiveAgents) {
      const timer = setTimeout(() => {
        if (autoModeRef.current && !typing) {
          const next = autoPromptRef.current
            ? `αυτόνομη συνέχεια — συνέχισε ό,τι ανέλαβες. Αν χρειάζεσαι βοήθεια από άλλους agents, επικοινώνησε απευθείας μαζί τους. Στόχος: ολοκλήρωσε την εργασία. Αρχική εντολή: ${autoPromptRef.current}`
            : 'συνέχισε αυτόνομα: συνέχισε την εργασία σου. Αν χρειαστεί, μίλησε με άλλους agents για να ολοκληρωθεί το αποτέλεσμα.'
          sendMessageRef.current(next)
        }
      }, 3000)
      return () => clearTimeout(timer)
    }
  }, [messages, autoMode, activeAgent, typing, hasActiveAgents])

  // Cleanup auto timer on unmount
  useEffect(() => { return () => { if (autoTimerRef.current) clearTimeout(autoTimerRef.current) } }, [])

  // Toast helper
  const addToast = useCallback((msg, type='info') => {
    const id = ++toastIdRef.current
    setToasts(prev => [...prev, {id, msg, type, _ts: Date.now()}])
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4000)
  }, [])

  // Keyboard shortcut: L → toggle Live sidebar
  useEffect(() => {
    function handleKey(e) {
      if (e.key === 'l' || e.key === 'L') {
        if (!e.target.closest('input,textarea,select')) setShowAgentSidebar(prev => !prev)
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [])

  // Engine + Health polling
  useEffect(() => {
    const poll = setInterval(() => {
      fetch(`${API}/api/health`).then(r => r.json()).then(d => {
        setHealthOk(d.status === 'ok')
      }).catch(() => setHealthOk(false))
      fetch(`${API}/api/engines`).then(r => r.json()).then(d => {
        setAllEngines(d.engines || [])
      }).catch(() => {})
    }, 8000)
    return () => clearInterval(poll)
  }, [])

  // Heartbeat polling — flag agents with no recent events
  useEffect(() => {
    const poll = setInterval(() => {
      fetch(`${API}/api/agent-heartbeat`).then(r=>r.json()).then(d => {
        if (d.last_seen) setLastSeenPerAgent(prev => ({...prev, ...d.last_seen}))
      }).catch(()=>{})
    }, 15000)
    return () => clearInterval(poll)
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
            setLiveEvents(prev => [...prev, {_liveType: 'api_request', content: `⚡ ${data.agent_id} ${data.state||(data.active?'active':'idle')}`, ts: data.ts || new Date().toISOString(), agent_id: data.agent_id}].slice(-100))
          } else if (data.type === 'engine_call') {
            setLiveEvents(prev => [...prev, {_liveType: 'engine_call', content: `${data.engine_id} → ${data.status||'calling'}${data.duration_s?` (${data.duration_s}s)`:''}`, ts: data.ts || new Date().toISOString(), agent_id: data.agent_id, engine_id: data.engine_id}].slice(-100))
          } else if (data.type === 'tool_exec') {
            setLiveEvents(prev => [...prev, {_liveType: 'tool_exec', content: `${data.tool} ${data.status||'run'} ${data.duration_s?`(${data.duration_s}s)`:''}`, ts: data.ts || new Date().toISOString(), agent_id: data.agent_id}].slice(-100))
          } else if (data.type === 'agent_thinking') {
            setThinkingEvents(prev => [...prev, {...data, _ts: Date.now()}].slice(-50))
            setCollabEvents(prev => [...prev, {...data, _ts: Date.now()}].slice(-100))
            setLastSeenPerAgent(prev => ({...prev, [data.agent_id]: 0}))
            if ((data.status === 'started' || data.status === 'thinking') && (!data._sid || data._sid === pendingRef.current.sessionId)) {
              setLiveEvents(prev => [...prev, {...data, _liveType: 'thinking'}].slice(-20))
            }
            if (data.status === 'complete') {
              setLiveEvents(prev => [...prev, {...data, _liveType: 'complete'}].slice(-20))
              const a = agents.find(x => x.id === data.agent_id)
              addToast(`✅ ${a?.icon||'🤖'} ${a?.name||data.agent_id} completed`, 'success')
            }
            if (data.status === 'error') {
              setLiveEvents(prev => [...prev, {...data, _liveType: 'error'}].slice(-20))
              const a = agents.find(x => x.id === data.agent_id)
              addToast(`❌ ${a?.icon||'🤖'} ${a?.name||data.agent_id} error`, 'error')
            }
            if (data.status === 'started' && data.agent_id !== activeAgentRef.current) {
              const a = agents.find(x => x.id === data.agent_id)
              setMessages(prev => {
                const exists = prev.some(m => m._aid === data.agent_id && m.role === 'system' && m.content?.includes('ξεκινά'))
                if (exists) return prev
                addToast(`⏳ ${a?.icon||''} ${a?.name||data.agent_id} started`, 'info')
                return [...prev, {role:'system', content:`⏳ ${a?.icon||''} ${a?.name||data.agent_id} ξεκινά εργασία... (εκτίμ. ${data.estimated_seconds||'?'}s)`, _aid: activeAgentRef.current, _sid: pendingRef.current.sessionId||'default', ts: new Date().toISOString(), _sysType: 'thinking'}]
              })
            }
            if (data.status === 'complete' && data.agent_id !== activeAgentRef.current) {
              const a = agents.find(x => x.id === data.agent_id)
              setMessages(prev => [...prev, {role:'system', content:`✅ ${a?.icon||''} ${a?.name||data.agent_id} ολοκλήρωσε σε ${data.duration_s||'?'}s`, _aid: activeAgentRef.current, _sid: pendingRef.current.sessionId||'default', ts: new Date().toISOString(), _sysType: 'info'}])
            }
          } else if (data.type === 'agent_chat') {
            setCollabEvents(prev => [...prev, {...data, _ts: Date.now()}].slice(-100))
            // Log agent response to backend log
            if (data.exchange) {
              const lastExchange = data.exchange[data.exchange.length - 1]
              const agent = agents.find(x => x.id === data.agent_id)
              setLiveEvents(prev => [...prev, {
                _liveType: 'complete',
                content: `${agent?.icon||'🤖'} ${data.agent_id} → ${lastExchange?.content?.slice(0,120)||'response'}`,
                ts: data.ts || new Date().toISOString(),
                agent_id: data.agent_id
              }].slice(-100))
            }
            if ((data.agent_id === activeAgentRef.current || activeAgentRef.current === 'ceo') && data.exchange) {
              setMessages(prev => {
                const ceoSession = activeSession?.sessionId || 'default'
                const newMsgs = data.exchange.filter(m =>
                  !prev.some(p => p._aid === m._aid && p._sid === ceoSession &&
                    p.content === m.content && p.role === m.role)
                ).map(m => ({...m, _sid: ceoSession, ts: m.ts || new Date().toISOString()}))
                if (activeAgentRef.current === 'ceo' && data.agent_id !== 'ceo') {
                  const ceoMsgs = data.exchange.filter(m =>
                    !prev.some(p => p._aid === 'ceo' && p._sid === ceoSession &&
                      p.content === m.content && p.role === m.role)
                  ).map(m => ({...m, _aid: 'ceo', _sid: ceoSession, ts: m.ts || new Date().toISOString()}))
                  return [...prev, ...newMsgs, ...ceoMsgs]
                }
                return [...prev, ...newMsgs]
              })
            }
          } else if (data.type === 'task_progress') {
            setTaskProgress(data)
            if (data.status === 'complete') setTimeout(() => setTaskProgress(null), 8000)
            setCollabEvents(prev => [...prev, {...data, _ts: Date.now()}].slice(-100))
            setLiveEvents(prev => [...prev, {...data, _liveType: 'progress'}].slice(-20))
          } else if (data.type === 'agent_comm') {
            setCommEvents(prev => [...prev, data].slice(-200))
            setCollabEvents(prev => [...prev, {...data, _ts: Date.now()}].slice(-100))
            setLiveEvents(prev => [...prev, {...data, _liveType: 'comm', ts: data.ts||new Date().toISOString()}].slice(-100))
            setLastSeenPerAgent(prev => ({...prev, [data.from]: 0, [data.to]: 0}))
          } else if (data.type === 'agent_tool_step') {
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
    // Save current session before switching
    const curAid = activeAgent
    const curSid = activeSession?.sessionId
    if (curAid && curSid && (curAid !== agentId || curSid !== sessionId)) {
      const currentMsgs = messagesRef.current.filter(m => m._aid === curAid && m._sid === curSid)
      if (currentMsgs.length > 0) {
        saveMessages(`${curAid}:${curSid}`, currentMsgs)
      }
    }
    setActiveAgent(agentId); setActiveSession({agentId,sessionId})
    setSelectedEngine(''); setCurrentEngine(''); setShowInfoInput(false)
    const msgs = (await loadMessages(`${agentId}:${sessionId}`)).map(m => ({...m, ts: m.ts || new Date().toISOString()}))
    setMessages(msgs)
  }, [activeAgent, activeSession])

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

  const toWordHtml = useCallback((content, isFull = false) => {
    const css = `body{font-family:Calibri,'Segoe UI',Arial,sans-serif;font-size:11pt;line-height:1.5;color:#1a1a2e;max-width:210mm;margin:20mm auto;padding:0 15mm}
h1,h2,h3,h4{font-weight:600;color:#1a1a2e;margin:0.6em 0 0.3em}
h1{font-size:18pt;border-bottom:2px solid #6366f1;padding-bottom:6pt}
h2{font-size:14pt} h3{font-size:12pt} h4{font-size:11pt}
p{margin:0.3em 0}
code{background:#f0f0f6;padding:1px 5px;border-radius:3px;font-family:'Cascadia Code','Fira Code',Consolas,'Courier New',monospace;font-size:9pt}
pre{background:#f7f7fc;border:1px solid #e0e0f0;border-radius:4px;padding:8pt 12pt;font-family:'Cascadia Code','Fira Code',Consolas,'Courier New',monospace;font-size:9pt;line-height:1.4;margin:6pt 0}
pre code{background:none;padding:0}
ul,ol{margin:0.3em 0;padding-left:1.5em}
li{margin:0.15em 0}
blockquote{border-left:3px solid #6366f1;padding-left:12pt;margin:0.5em 0;color:#555;font-style:italic}
strong{font-weight:600} em{font-style:italic}
a{color:#6366f1;text-decoration:underline}
hr{border:none;border-top:1px solid #e0e0e0;margin:0.8em 0}
table{border-collapse:collapse;width:100%;margin:0.5em 0;font-size:10pt}
th,td{border:1px solid #ddd;padding:4pt 8pt;text-align:left}
th{background:#f0f0f6;font-weight:600}
img{max-width:100%;height:auto}`
    const shell = `<!DOCTYPE html>
<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
<head><meta charset="utf-8"><meta http-equiv="Content-Type" content="text/html; charset=utf-8">
<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom></w:WordDocument></xml><![endif]-->
<style>${css}</style></head><body>${content}</body></html>`
    return isFull ? shell : content
  }, [])

  const exportWord = useCallback(() => {
    const agent = currentAgent?.name||'Agent'
    const icon = currentAgent?.icon||''
    const project = currentProject === 'default' ? '' : currentProject.replace(/_/g, ' ')
    const date = new Date().toLocaleDateString('el-GR', {weekday:'long',year:'numeric',month:'long',day:'numeric'})
    const time = fmtTs(new Date().toISOString())

    const rows = displayMessages.map((m) => {
      const cfg = m.role==='user'?{label:'Χρήστης',icon:'👤',bg:'#f0f4ff',color:'#1a1a2e'}:
        m.role==='assistant'?{label:'Απάντηση',icon:'🤖',bg:'#ffffff',color:'#1a1a2e'}:
        m.role==='error'?{label:'Σφάλμα',icon:'⚠️',bg:'#fef2f2',color:'#991b1b'}:
        m.role==='tool_use'?{label:'Εργαλείο: '+(m.name||''),icon:'🔧',bg:'#fffbeb',color:'#92400e'}:
        m.role==='tool_result'?{label:'Αποτέλεσμα: '+(m.name||''),icon:'📎',bg:'#fafafa',color:'#444'}:null
      if (!cfg) return ''
      const content = (m.content||JSON.stringify(m.args||'')||m.result||'').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>')
      const ts = m.ts ? fmtTime(m.ts) : ''
      return `<tr${m.role==='assistant'?' style="background:#fafbff"':''}>
        <td style="padding:10pt 16pt;background:${cfg.bg};border-bottom:1px solid #e5e7eb">
          <table style="width:100%;border-collapse:collapse"><tr>
            <td style="width:24pt;vertical-align:top;font-size:14pt;padding-top:1pt">${cfg.icon}</td>
            <td style="vertical-align:top">
              <div style="font-weight:600;font-size:9pt;color:#6366f1;margin-bottom:2pt;text-transform:uppercase;letter-spacing:0.5pt">${cfg.label}</div>
              <div style="font-size:10.5pt;line-height:1.55;color:${cfg.color}">${content}</div>
            </td>
            ${ts?`<td style="width:48pt;vertical-align:top;text-align:right;font-size:7.5pt;color:#999;white-space:nowrap;padding-top:2pt">${ts}</td>`:''}
          </tr></table>
        </td>
      </tr>`
    }).filter(Boolean).join('\n')

    const body = `
<div style="border-bottom:2px solid #6366f1;padding-bottom:10pt;margin-bottom:16pt">
  <h1 style="margin:0;font-size:20pt;font-weight:700">${icon} ${agent}</h1>
  ${project?`<div style="font-size:10pt;color:#6366f1;margin-top:4pt"><strong>Project:</strong> ${project}</div>`:''}
  <div style="font-size:8pt;color:#888;margin-top:2pt">${date} · ${time} · AIONCLAW</div>
</div>
<table style="width:100%;border-collapse:collapse">${rows}</table>
<div style="margin-top:24pt;padding-top:8pt;border-top:1px solid #e0e0e0;font-size:7.5pt;color:#aaa;text-align:center">
  AIONCLAW — Εξαγωγή: ${date} ${time}
</div>`
    const html = toWordHtml(body, true)
    const blob = new Blob([html], {type:'application/msword'})
    const a = document.createElement('a'); a.href=URL.createObjectURL(blob)
    a.download=`${agent}_${date.replace(/\s/g,'_').replace(/\./g,'_')}.doc`; a.click()
    URL.revokeObjectURL(a.href)
  }, [displayMessages, currentAgent, currentProject, toWordHtml])

  const exportExcel = useCallback(() => {
    const agent = currentAgent?.name||'Agent'
    const date = new Date().toISOString().slice(0,10)
    function stripToolCalls(text) {
      return (text||'').replace(/<longcat_tool_call>[\s\S]*?<\/longcat_tool_call>/g, '').replace(/<[^>]+>/g, '').trim()
    }
    const rows = displayMessages.map((m) => {
      const roleLabel = m.role==='user'?'User':m.role==='assistant'?'Assistant':m.role==='error'?'Error':m.role==='tool_use'?`Tool: ${m.name}`:m.role==='tool_result'?`Result: ${m.name}`:m.role
      const raw = m.content||JSON.stringify(m.args||'')||m.result||''
      const clean = stripToolCalls(raw).replace(/"/g,'""')
      const ts = m.ts ? new Date(m.ts).toISOString() : ''
      return `"${agent}","${date}","${roleLabel}","${ts}","${clean}"`
    }).join('\n')
    const csv = `Agent,Date,Role,Timestamp,Message\n${rows}`
    const blob = new Blob([csv], {type:'text/csv;charset=utf-8'})
    const a = document.createElement('a'); a.href=URL.createObjectURL(blob)
    a.download=`${agent}_${date}.csv`; a.click()
    URL.revokeObjectURL(a.href)
  }, [displayMessages, currentAgent])

  const copyMessage = useCallback(async (msg, idx) => {
    const isHtml = msg.role==='assistant' && /<\/?[a-zA-Z][^>]*>/.test(msg.content)
    const plain = isHtml ? msg.content.replace(/<[^>]*>/g,'') : msg.content
    const fullHtml = isHtml
      ? toWordHtml(msg.content, true)
      : toWordHtml(`<p>${msg.content.replace(/\n/g,'<br>')}</p>`, true)
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': new Blob([fullHtml], {type:'text/html'}),
          'text/plain': new Blob([plain], {type:'text/plain'})
        })
      ])
    } catch {
      await navigator.clipboard.writeText(plain)
    }
    setCopiedIndex(idx)
    setTimeout(() => setCopiedIndex(null), 1500)
  }, [toWordHtml])

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
    const colors = {started:'border-blue-800/30 bg-blue-950/30',
      thinking:'border-indigo-800/30 bg-indigo-950/30',
      synthesizing:'border-accent/30 bg-accent/10',
      complete:'border-success/30 bg-success/10',
      error:'border-error/30 bg-error/10'}
    const pulses = {started:'bg-blue-400',thinking:'bg-indigo-400',synthesizing:'bg-accent'}
    const c = colors[ev.status]||'border-app-elevated/30 bg-app-elevated/10'
    const p = pulses[ev.status]
    return (
      <div key={ev.id||ev._ts} className={`rounded-lg p-2 border ${c} transition-all duration-300`}>
        <div className="flex items-center gap-1.5 mb-0.5">
          <span className="text-xs">{icon}</span>
          <span className="text-[10px] font-medium text-text-secondary">{ev.agent_id}</span>
          {p&&<span className={`w-1.5 h-1.5 rounded-full ${p} animate-pulse ml-auto`}/>}
          {ev.status==='complete'&&<span className="text-[9px] text-success ml-auto">✓</span>}
          {ev.status==='error'&&<span className="text-[9px] text-error ml-auto">✕</span>}
        </div>
        <div className="text-[10px] text-text-secondary leading-relaxed">{ev.thought}</div>
        {ev.remaining_seconds>0&&ev.status!=='complete'&&ev.status!=='error'&&(
          <div className="mt-1 flex items-center gap-2">
            <div className="flex-1 h-1 bg-app-elevated rounded-full overflow-hidden">
              <div className="h-full bg-accent rounded-full animate-pulse" style={{width:`${Math.min(100,ev.progress||50)}%`}}/>
            </div>
            <span className="text-[9px] text-accent/80 shrink-0">~{ev.remaining_seconds}s</span>
          </div>
        )}
        {ev.duration_s&&<div className="text-[9px] text-success/80 mt-0.5">{ev.duration_s}s</div>}
        <div className="text-[8px] text-text-dim mt-0.5">{fmtTime(ev.ts)}</div>
      </div>
    )
  }

  return (
    <div className="h-screen flex flex-col bg-app-base text-text-primary font-sans overflow-hidden">
      {/* TOP BAR */}
      <div className="flex items-center gap-1 px-4 py-1.5 bg-app-surface border-b border-app-elevated shrink-0 overflow-x-auto z-10">
        <span className="text-accent font-bold text-sm mr-2 shrink-0">AIONCLAW</span>
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${healthOk && connected ? 'bg-success animate-pulse' : 'bg-red-500'}`} title={healthOk ? 'backend online' : 'backend offline'} />
        <span className="text-[10px] text-gray-500 shrink-0 font-mono">{allEngines.length} engines</span>
        <span className="text-[10px] text-gray-600 shrink-0">· {agents.length} agents</span>
        <span className="text-[10px] text-gray-600 shrink-0">· {currentProject !== 'default' ? currentProject.replace(/_/g, ' ') : ''}</span>
        <div className="h-4 w-px bg-app-elevated mx-2 shrink-0" />
        {agents.map(a => {
          const isWorking = thinkingEvents.some(e => e.agent_id === a.id && (e.status==='thinking'||e.status==='started'||e.status==='synthesizing'))
          const isError = thinkingEvents.some(e => e.agent_id === a.id && e.status === 'error')
          const isComplete = thinkingEvents.some(e => e.agent_id === a.id && e.status === 'complete' && (Date.now() - new Date(e.ts).getTime()) < 15000)
          const sc = isWorking ? 'active' : isError ? 'error' : isComplete ? 'done' : 'idle'
          const lastEvent = [...thinkingEvents].reverse().find(e => e.agent_id === a.id)
          const tip = sc === 'active' ? (lastEvent?.thought?.slice(0,80)||'working') : sc === 'error' ? 'error' : sc === 'done' ? 'completed' : 'idle'
          return <span key={a.id} className={`agent-dot ${sc}`} title={`${a.icon} ${a.name}: ${tip}`} />
        })}
        <div className="h-4 w-px bg-app-elevated mx-2 shrink-0" />
        <div className="ml-auto flex items-center gap-1 shrink-0">
          <button onClick={()=>setShowAgentSidebar(prev => !prev)}
            className={`text-[10px] px-2 py-1 rounded transition-colors ${showAgentSidebar ? 'bg-accent/20 text-accent' : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800'}`}>📡 Live</button>
          <button onClick={()=>setShowCollab(!showCollab)} className={`text-[10px] px-2 py-1 rounded transition-colors ${showCollab ? 'bg-accent/20 text-accent' : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800'}`}>📋 Team</button>
          <button onClick={()=>setSidebarPanel('leads')} className="text-[10px] px-2 py-1 rounded text-gray-500 hover:text-gray-300 hover:bg-gray-800">📊 CRM</button>
          <button onClick={()=>setSidebarPanel('files')} className="text-[10px] px-2 py-1 rounded text-gray-500 hover:text-gray-300 hover:bg-gray-800">📁 Files</button>
          <button onClick={()=>setSidebarPanel('settings')} className="text-[10px] px-2 py-1 rounded text-gray-500 hover:text-gray-300 hover:bg-gray-800">⚙ Settings</button>
          <button onClick={async()=>{try{const r=await fetch(`${API}/api/knowledge/stats?project=${currentProject}`);setKbStats(await r.json());setKbTab('browse');setShowKnowledge(true)}catch(_){}}}
            className="text-[10px] px-2 py-1 rounded text-gray-500 hover:text-amber-300 hover:bg-gray-800">🧠 KB</button>
          <button onClick={()=>{fetch(`${API}/api/agent-perf`).then(r=>r.json()).then(d=>d.stats&&setAgentPerf(d.stats)).catch(()=>{});fetch(`${API}/api/comm-log`).then(r=>r.json()).then(d=>d.entries&&setCommEvents(d.entries)).catch(()=>{});setShowConsole(true)}}
            className={`text-[10px] px-2 py-1 rounded transition-colors ${hasActiveAgents ? 'console-btn-live text-yellow-300 bg-yellow-500/10' : 'text-emerald-400 hover:text-emerald-300 hover:bg-gray-800'}`}>🎮 Console</button>
        </div>
      </div>

      {/* ENGINE STATUS STRIP */}
      <div className="flex items-center gap-1.5 px-4 py-1 bg-app-elevated/60 border-b border-app-elevated shrink-0 overflow-x-auto min-h-[28px]">
        {allEngines.map(e => {
          const status = e.status || 'unknown'
          const statusColor = status === 'active' ? 'bg-success' : status === 'degraded' ? 'bg-warning' : status === 'rate_limited' ? 'bg-info' : status === 'quota_exhausted' || status === 'needs_key' ? 'bg-error' : status === 'timeout' ? 'bg-warning' : 'bg-text-dim'
          return (
            <span key={e.id} className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-app-elevated/80 border border-app-elevated text-[9px] whitespace-nowrap" title={`${e.name} · ${e.model} · priority ${e.priority} · ${e.capability} · ${e.speed_rating}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${statusColor}`} />
              <span className="text-gray-400 max-w-[60px] truncate">{e.id}</span>
              <span className="text-gray-600">{status}</span>
            </span>
          )
        })}
        <span className="text-gray-700 text-[9px] ml-auto shrink-0 whitespace-nowrap">{new Date().toLocaleTimeString('el-GR', {hour:'2-digit',minute:'2-digit',second:'2-digit'})}</span>
      </div>

      <div className="flex flex-1 min-h-0">
        {/* LEFT SIDEBAR */}
        <div className="w-56 bg-app-surface border-r border-app-elevated flex flex-col shrink-0">
          <div className="flex items-center justify-between px-4 py-3 border-b border-app-elevated">
            <h1 className="text-sm font-bold text-accent">AIONCLAW</h1>
          </div>
          {sidebarContent ? (
            <div className="flex-1 overflow-y-auto min-h-0">{sidebarContent}</div>
          ) : (
            <div className="flex-1 flex flex-col min-h-0">
              <div className="flex-1 overflow-y-auto p-2 space-y-2">
                {Object.entries(CATEGORIES).map(([cat, agentIds]) => {
                  const catAgents = agents.filter(a => agentIds.includes(a.id))
                  if (catAgents.length === 0) return null
                  const hasActive = catAgents.some(a => a.id === activeAgent)
                  const expanded = !collapsedCategories[cat]
                  return (
                    <div key={cat}>
                      <button onClick={() => setCollapsedCategories(prev => ({...prev, [cat]: !prev[cat]}))}
                        className={`w-full flex items-center gap-1 px-2 py-1 text-[9px] uppercase tracking-wider font-medium transition-all rounded-sm ${hasActive ? 'text-accent border-l-[3px] border-accent bg-accent/[0.04]' : 'text-text-dim border-l-[3px] border-transparent hover:text-text-secondary'}`}>
                        <span className="text-[7px] opacity-60">{expanded ? '▾' : '▸'}</span>
                        <span>{cat}</span>
                        <span className="text-[8px] opacity-40 ml-auto">{catAgents.length}</span>
                      </button>
                      {expanded && (
                        <div className="ml-1 mt-0.5 space-y-0.5 border-l border-app-elevated/60 pl-1">
                          {catAgents.map(a => {
                            const isActive = activeAgent === a.id
                            const status = activeAgents[a.id]
                            const isThinking = thinkingEvents.some(e => e.agent_id === a.id && (e.status==='thinking'||e.status==='started'||e.status==='synthesizing'))
                            const isError = thinkingEvents.some(e => e.agent_id === a.id && e.status === 'error')
                            const dotClass = isThinking ? 'bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.5)]' : isError ? 'bg-red-500' : status === 'writing' ? 'bg-success' : status && status !== 'idle' ? 'bg-warning' : 'bg-text-dim/40'
                            const lastEvent = [...thinkingEvents].reverse().find(e => e.agent_id === a.id)
                            const taskHint = isThinking && lastEvent?.thought ? lastEvent.thought.slice(0,40) : ''
                            const rowClass = isActive ? 'sidebar-agent-row active' : 'sidebar-agent-row idle'
                            return (
                              <button key={a.id} onClick={()=>switchAgent(a.id)}
                                className={rowClass}>
                                <span className={`w-2 h-2 rounded-full shrink-0 ${dotClass}`} title={status||'idle'} />
                                <span className="shrink-0">{a.icon}</span>
                                <span className="truncate text-[11px]">{a.name}</span>
                                {isActive && <span className="w-1 h-1 bg-amber-400 rounded-full ml-auto shrink-0"/>}
                                {isThinking && taskHint && <span className="text-[8px] text-amber-400/70 truncate ml-1 max-w-[60px]">{taskHint}</span>}
                              </button>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )
                })}

                {/* Session tabs — inline with agents */}
                <div className="border-t border-app-elevated pt-2 mt-2">
                  <button onClick={addSession}
                    className="w-full text-xs text-text-secondary hover:text-accent px-3 py-2 rounded-lg border border-dashed border-app-elevated hover:border-accent/40 transition-colors flex items-center gap-2">
                    <span className="text-sm leading-none">+</span><span>New Chat</span>
                  </button>
                </div>
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

                {/* Working Team — live delegation status with agent responses */}
                {(thinkingEvents.some(e => e.status === 'started' || e.status === 'thinking' || e.status === 'synthesizing') || commEvents.some(e => {
                  const age = Date.now() - new Date(e.ts||Date.now()).getTime()
                  return age < 60000
                })) && (
                  <div className="border-t border-amber-500/20 pt-2 mt-1">
                    <div className="text-[9px] text-amber-400/70 uppercase tracking-wider font-medium px-1 mb-1">⚡ Working Team</div>
                    <div className="space-y-0.5 px-1">
                      {(() => {
                        const now = Date.now()
                        const activeIds = new Set()
                        thinkingEvents.filter(e => (e.status === 'started' || e.status === 'thinking' || e.status === 'synthesizing')).forEach(e => activeIds.add(e.agent_id))
                        commEvents.filter(e => now - new Date(e.ts||now).getTime() < 60000).forEach(e => { activeIds.add(e.from); activeIds.add(e.to) })
                        collabEvents.filter(e => (e.type === 'agent_chat' || e.type === 'agent_comm') && now - (e._ts||now) < 60000).forEach(e => {
                          if (e.from) activeIds.add(e.from); if (e.to) activeIds.add(e.to); if (e.agent_id) activeIds.add(e.agent_id)
                        })
                        return agents.filter(a => activeIds.has(a.id))
                      })().map(a => {
                        const evs = thinkingEvents.filter(e => e.agent_id === a.id)
                        const last = evs[evs.length - 1]
                        const isWorking = evs.some(e => e.status === 'started' || e.status === 'thinking' || e.status === 'synthesizing')
                        const recentComm = commEvents.filter(e => (e.from === a.id || e.to === a.id) && Date.now() - new Date(e.ts||now).getTime() < 60000)
                        const lastComm = recentComm[recentComm.length - 1]
                        const duration = last?.started_at ? Math.floor((Date.now() - new Date(last.started_at).getTime()) / 1000) : 0
                        const dotStatus = isWorking ? 'bg-amber-400 animate-pulse' : 'bg-green-500'
                        return (
                          <div key={a.id} className="flex items-center gap-1.5 py-1 px-1.5 rounded bg-amber-500/5 border border-amber-500/10 text-[10px]">
                            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotStatus}`} />
                            <span className="shrink-0">{a.icon}</span>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1">
                                <span className="text-amber-300 font-medium truncate">{a.name}</span>
                                <span className="text-amber-500/60 ml-auto">{duration > 0 ? `${duration}s` : ''}</span>
                              </div>
                              {isWorking && last?.thought && <div className="text-[8px] text-amber-400/60 truncate">{last.thought.slice(0,60)}</div>}
                              {!isWorking && lastComm && <div className="text-[8px] text-green-400/60 truncate">→ {lastComm.action}</div>}
                              {!isWorking && !lastComm && last?.status === 'complete' && <div className="text-[8px] text-green-400/60">✅ completed</div>}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* CHAT AREA */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Chat header */}
          <div className="flex items-center gap-3 px-6 py-2 border-b border-app-elevated bg-app-surface/50 text-xs shrink-0">
            <span className="text-lg">{currentAgent?.icon}</span>
            <div>
              <span className="text-accent font-medium">{currentAgent?.name}</span>
              <span className="text-gray-600 ml-2">{agentSessions.find(s=>s.id===activeSession?.sessionId)?.label||'Chat'}</span>
            </div>
            <div className="flex items-center gap-2 ml-4">
              {currentEngine&&<span className="text-gray-500 flex items-center gap-1"><span className="w-1.5 h-1.5 bg-success rounded-full animate-pulse"/>{engines.find(e=>e.id===currentEngine)?.name||currentEngine}</span>}
              {currentTool&&<span className="text-amber-400 text-[10px] flex items-center gap-1"><span className="w-1.5 h-1.5 bg-amber-400 rounded-full animate-pulse"/>⚡ {currentTool}...</span>}
              {typing&&<span className="text-gray-500 flex items-center gap-1"><span className="w-1.5 h-1.5 bg-accent rounded-full animate-pulse"/>Generating...</span>}
              {loadingHistory&&<span className="text-gray-500">Loading...</span>}
            </div>
            <div className="ml-auto flex items-center gap-1">
              {displayMessages.length>0&&(
                <>
                  <button onClick={exportWord} className="text-gray-500 hover:text-accent transition-colors px-2 py-1 rounded hover:bg-gray-800 text-[10px] flex items-center gap-1" title="Export to Word">📄 Word</button>
                  <button onClick={() => {
                    const url = `${API}/api/export/doc?session_id=${activeSession?.sessionId||'default'}&agent_id=${activeAgent}`
                    navigator.clipboard.writeText(url).then(() => addToast('📋 Link copied', 'success'))
                  }} className="text-gray-500 hover:text-accent transition-colors px-2 py-1 rounded hover:bg-gray-800 text-[10px]" title="Copy shareable link to Word export">🔗</button>
                  <button onClick={exportExcel} className="text-gray-500 hover:text-accent transition-colors px-2 py-1 rounded hover:bg-gray-800 text-[10px] flex items-center gap-1" title="Export to Excel">📊 Excel</button>
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
              <div key={i} className={`msg-row ${msg.role}`}>
                {msg.role==='assistant'&&<div className="msg-avatar">{currentAgent?.icon||'🤖'}</div>}
                <div className={`msg-bubble ${msg.role}${msg.role==='system'&&msg._sysType?` ${msg._sysType}`:''}`}>
                  {msg.role==='system'&&(
                    <div className="flex items-start gap-1.5">
                      {msg._sysType==='thinking'&&<span className="text-accent/70 text-[10px] shrink-0 mt-[1px]">⏳</span>}
                      {msg._sysType==='warning'&&<span className="text-warning text-[10px] shrink-0 mt-[1px]">⚠️</span>}
                      {msg._sysType==='info'&&<span className="text-text-dim/50 text-[10px] shrink-0 mt-[1px]">ℹ️</span>}
                      {!msg._sysType&&<span className="text-text-dim/50 text-[10px] shrink-0 mt-[1px]">·</span>}
                      <span className={msg._sysType==='thinking'?'text-accent/80':msg._sysType==='warning'?'text-warning':'text-text-dim italic'}>
                        {msg.content.replace(/^📝 /,'').replace(/^📎 /,'')}
                      </span>
                    </div>
                  )}
                  {msg.role==='tool_use'&&<>
                    <div className="font-medium mb-1 flex items-center gap-2">
                      {currentTool===msg.name ? <span className="w-2 h-2 bg-warning rounded-full animate-pulse" /> : <span className="w-2 h-2 bg-text-dim rounded-full" />}
                      🔧 {msg.name}
                      {currentTool===msg.name && <span className="text-warning text-[10px] animate-pulse ml-auto">executing...</span>}
                    </div>
                    <pre className="text-xs opacity-70">{JSON.stringify(msg.args,null,1).slice(0,200)}</pre>
                  </>}
                  {msg.role==='tool_result'&&<>
                    <div className="text-text-dim mb-1">← {msg.name}</div>
                    {/<\/?[a-zA-Z][^>]*>/.test(msg.result||'')
                      ? <div className="render-html" dangerouslySetInnerHTML={{__html: msg.result}} />
                      : <div className="leading-relaxed" dangerouslySetInnerHTML={{__html: renderMd(msg.result||'')}} />}
                  </>}
                  {(msg.role==='assistant'||msg.role==='user')&&(
                    msg.role==='assistant' && /<\/?[a-zA-Z][^>]*>/.test(msg.content)
                      ? <div className="render-html" dangerouslySetInnerHTML={{__html: msg.content}} />
                      : msg.role==='assistant'
                        ? <div className="leading-relaxed" dangerouslySetInnerHTML={{__html: renderMd(msg.content)}} />
                        : <div className="whitespace-pre-wrap break-words leading-relaxed">{msg.content}</div>
                  )}
                  {msg._grouped && msg.tools?.length > 0 && (
                    <div>
                      <div className="tool-bar" onClick={() => setExpandedTools(prev => ({...prev, [i]: !prev[i]}))}>
                        <span className="tool-bar-icon">🔧</span>
                        {msg.tools.length === 1 ? (
                          <><span className="tool-bar-name">{msg.tools[0].name}</span></>
                        ) : (
                          <><span className="tool-bar-count">{msg.tools.length}</span><span>tools</span></>
                        )}
                        <span className="tool-bar-duration">{msg._totalDuration || msg.tools[0]?.duration}s</span>
                        <span className={`tool-bar-arrow ${expandedTools[i] ? 'open' : ''}`}>▸</span>
                      </div>
                      {expandedTools[i] && (
                        <div className="mt-1.5 space-y-1.5">
                          {msg.tools.map((t,j) => (
                            <div key={j} className="tool-item">
                              <div className="tool-item-header">
                                <span>🔧</span>
                                <span className="tool-item-name">{t.name}</span>
                                {t.duration && <span className="tool-item-duration">{t.duration}s</span>}
                              </div>
                              {t.args && <div className="tool-item-args">{JSON.stringify(t.args).slice(0,120)}</div>}
                              {t.result && <div className="tool-item-result">{t.result.slice(0,200)}</div>}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                  {msg.role==='error'&&<div className="whitespace-pre-wrap break-words text-sm">{msg.content}</div>}
                  {msg.ts && (msg.role==='assistant'||msg.role==='user')&&(
                    <div className="msg-time">{fmtTs(msg.ts)}</div>
                  )}
                  {(msg.role==='assistant')&&(
                    <div className="msg-actions">
                      <button onClick={()=>copyMessage(msg, i)} className="msg-action-btn" title="Copy">
                        {copiedIndex===i?'✓':'📋'}
                      </button>
                    </div>
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
                <div className="bg-app-surface border border-app-elevated rounded-2xl shadow-sm">
                  <div className="typing-wave">
                    <span className="typing-dot" />
                    <span className="typing-dot" />
                    <span className="typing-dot" />
                  </div>
                </div>
              </div>
            )}

            {taskProgress && taskProgress.status !== 'complete' && (
              <div className="flex justify-start">
                <div className="w-full max-w-md bg-app-surface/60 rounded-xl p-3 border border-accent/30">
                  <div className="flex items-center gap-2 text-xs text-text-secondary mb-1.5">
                    <span className="text-sm">{agents.find(a=>a.id===taskProgress.agent_id)?.icon||'🤖'}</span>
                    <span>{taskProgress.message}</span>
                    <span className="ml-auto text-accent">{taskProgress.progress}%</span>
                  </div>
                  <div className="h-1.5 bg-app-elevated rounded-full overflow-hidden">
                    <div className="h-full bg-gradient-to-r from-accent to-accent-dim rounded-full transition-all duration-500"
                      style={{width:`${taskProgress.progress}%`}} />
                  </div>
                  {taskProgress.remaining_seconds > 0 && (
                    <div className="flex items-center gap-2 mt-1">
                      <div className="flex-1 h-0.5 bg-app-elevated rounded-full overflow-hidden">
                        <div className="h-full bg-accent rounded-full animate-pulse" style={{width:`${Math.min(100,taskProgress.progress)}%`}}/>
                      </div>
                      <span className="text-[10px] text-accent/80 shrink-0">~{taskProgress.remaining_seconds}s</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {taskProgress && taskProgress.status === 'complete' && taskProgress.duration_s && (
              <div className="flex justify-start">
                <div className="bg-app-surface rounded-xl px-3 py-2 border border-success/30 text-xs text-text-secondary flex items-center gap-2">
                  <span>✅ {agents.find(a=>a.id===taskProgress.agent_id)?.icon} {taskProgress.agent_id}</span>
                  <span className="text-success">{taskProgress.duration_s}s</span>
                </div>
              </div>
            )}
          </div>



          <div className="border-t border-app-elevated/60 px-4 py-3 bg-app-surface/30">
            <div className="flex gap-2 max-w-4xl mx-auto items-end">
              <div className="flex-1 flex gap-2 items-end bg-app-elevated/80 border border-app-elevated rounded-2xl px-4 py-2 focus-within:border-accent/60 focus-within:shadow-[0_0_0_3px_var(--accent-glow)] transition-all">
                <textarea value={input} onChange={e=>{setInput(e.target.value);e.target.style.height='auto';e.target.style.height=Math.min(e.target.scrollHeight,200)+'px'}}
                  onKeyDown={handleKeyDown}
                  placeholder={connected?`Μήνυμα στον ${currentAgent?.name}...`:'Connecting...'}
                  disabled={!connected}
                  rows={1}
                  className="flex-1 resize-none bg-transparent text-sm text-text-primary placeholder-text-dim/50 focus:outline-none disabled:opacity-40 leading-relaxed max-h-[200px]"
                  style={{minHeight:'24px'}}
                />
                <button onClick={() => fileInputRef.current?.click()}
                  className="text-text-dim/60 hover:text-accent transition-colors text-sm shrink-0" title="Upload file">📎</button>
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
              {typing && (
                <button onClick={stopGeneration} className="bg-error/10 hover:bg-error/20 text-error rounded-full px-4 py-2 font-medium transition-all flex items-center gap-1.5 text-sm border border-error/20 shrink-0"><span>■</span></button>
              )}
              <button onClick={() => {
                if (autoMode) {
                  setAutoMode(false); autoModeRef.current = false
                  if (autoTimerRef.current) { clearTimeout(autoTimerRef.current); autoTimerRef.current = null }
                  addToast('⏹ Auto mode stopped', 'info')
                } else {
                  const prompt = input.trim() || 'συνέχισε'
                  autoPromptRef.current = prompt
                  setAutoMode(true); autoModeRef.current = true
                  addToast('▶ Auto mode: ' + prompt.slice(0,40), 'success')
                  sendMessageFn(prompt)
                }
              }}
                className={`text-[10px] px-2.5 py-2 rounded-full font-bold transition-all shrink-0 ${autoMode ? 'bg-green-500/20 text-green-400 border border-green-500/40 animate-pulse' : 'bg-app-elevated text-gray-400 hover:text-gray-300 border border-app-elevated'}`}
                title={autoMode ? 'Stop auto mode' : 'Αυτόνομη συνέχεια: ο agent συνεχίζει μέχρι να ολοκληρωθεί'}>
                {autoMode ? '■' : '♾️'}
              </button>
              <button onClick={()=>sendMessageFn(input)} disabled={!connected||!input.trim()}
                className="bg-accent hover:bg-accent-dim disabled:bg-app-elevated text-white rounded-full px-5 py-2.5 font-medium transition-all disabled:text-text-dim shrink-0 text-sm">Send →</button>
            </div>
          </div>
        </div>

        {/* CONTEXT DRAWER — overlay from right with tabs */}
        {showCollab && (
          <>
            <div className="fixed inset-0 z-40" onClick={()=>setShowCollab(false)} />
            <div className="fixed right-0 top-0 bottom-0 w-80 bg-app-surface/95 backdrop-blur-sm border-l border-app-elevated flex flex-col z-50 shadow-2xl shadow-black/50 animate-fade-in">
              <div className="px-4 py-3 border-b border-app-elevated flex items-center justify-between shrink-0">
                <div className="flex items-center gap-2">
                  <span className="text-text-secondary uppercase font-medium tracking-wider text-[10px]">Context</span>
                  {thinkingEvents.some(e => e.status !== 'complete' && e.status !== 'error') && (
                    <span className="flex items-center gap-1 text-accent/70 text-[9px]">
                      <span className="w-1.5 h-1.5 bg-accent rounded-full animate-pulse"/>
                      live
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1.5">
                  <button onClick={()=>{setShowProjectInput(!showProjectInput)}} className="text-text-dim hover:text-accent transition-colors text-[10px]" title="New project">✦</button>
                  <button onClick={clearCollab} className="text-text-dim hover:text-error transition-colors text-[10px]" title="Clear">✕</button>
                  <button onClick={()=>setShowCollab(false)} className="text-text-dim hover:text-text-primary transition-colors text-xs ml-1">✕</button>
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
                }} className="flex gap-1 p-2 border-b border-app-elevated">
                  <input name="project" placeholder="project name..." className="flex-1 bg-app-elevated border border-app-elevated rounded px-2 py-1 text-[10px] text-text-primary placeholder-text-dim focus:outline-none focus:border-accent"/>
                </form>
              )}

              {/* Tabs */}
              <div className="flex border-b border-app-elevated px-3 pt-1 gap-0">
                <button onClick={()=>setDrawerTab('activity')} className={`drawer-tab ${drawerTab==='activity'?'active':''}`}>
                  ⚡ Activity
                </button>
                <button onClick={()=>setDrawerTab('log')} className={`drawer-tab ${drawerTab==='log'?'active':''}`}>
                  📋 Log
                </button>
                <button onClick={()=>setDrawerTab('comm')} className={`drawer-tab ${drawerTab==='comm'?'active':''}`}>
                  💬 Comm
                </button>
                <button onClick={()=>setDrawerTab('projects')} className={`drawer-tab ${drawerTab==='projects'?'active':''}`}>
                  📁 Projects
                </button>
              </div>

              {/* Tab: Activity */}
              {drawerTab === 'activity' && (
                <div className="flex-1 overflow-y-auto px-2 py-2 space-y-1">
                  {recentThinking.length === 0 ? (
                    <div className="text-center py-8 text-text-dim text-[10px]">Waiting for agent activity...</div>
                  ) : (
                    recentThinking.map((ev, i) => agentThinks({...ev, id: ev.id||i, _ts: ev._ts||i}))
                  )}
                </div>
              )}

              {/* Tab: Log */}
              {drawerTab === 'log' && (
                <div ref={collabRef} className="flex-1 overflow-y-auto px-2 py-1 space-y-1">
                  {collabEvents.length === 0 && (
                    <div className="text-center py-8 text-text-dim text-[10px]">No activity yet.</div>
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
                        className={`w-full text-left rounded-lg p-2 border transition-colors ${isRead ? 'bg-transparent border-transparent' : 'bg-app-elevated/60 border-app-elevated hover:bg-app-elevated'}`}>
                        <div className={`flex items-center gap-1.5 mb-0.5 ${isRead ? 'opacity-40' : ''}`}>
                          <span className="text-sm">{fromAgent?.icon||'🤖'}</span>
                          <span className={`text-[10px] font-medium ${isRead ? 'text-text-dim line-through' : 'text-text-secondary'}`}>{fromAgent?.name||ev.from}{ev.to?` → ${toAgent?.name||ev.to}`:''}</span>
                        </div>
                        <div className={`text-[10px] ${isRead ? 'opacity-30 line-through text-text-dim' : ev.action === 'delegate' ? 'text-warning' : ev.action === 'result' ? 'text-success/70' : ev.type === 'task_progress' ? 'text-accent/80' : 'text-text-secondary'}`}>
                          {ev.action === 'delegate' ? '📋 Ανάθεση' : ev.action === 'result' ? '✅ Αποτέλεσμα' : ev.type === 'task_progress' ? (ev.status==='complete'?'✅ Ολοκληρώθηκε':`🔧 ${ev.progress}%`): ev.action||ev.type}
                        </div>
                        <div className={`text-[10px] mt-0.5 line-clamp-2 ${isRead ? 'text-text-dim line-through opacity-40' : 'text-text-dim'}`}>{ev.content||ev.thought||ev.message||''}</div>
                        <div className={`text-[8px] mt-0.5 ${isRead ? 'text-text-dim/30' : 'text-text-dim'}`}>{fmtTime(ev.ts)}</div>
                      </button>
                    )
                  })}
                </div>
              )}

              {/* Tab: Comm (Agent-to-Agent) */}
              {drawerTab === 'comm' && (
                <div className="flex-1 overflow-y-auto px-2 py-1 space-y-1">
                  {commEvents.length === 0 ? (
                    <div className="text-center py-8 text-text-dim text-[10px]">No agent communications yet. Send a task to see interactions.</div>
                  ) : (
                    [...commEvents].reverse().slice(0, 100).map((ev, i) => {
                      const fromAg = agents.find(x => x.id === ev.from)
                      const toAg = agents.find(x => x.id === ev.to)
                      const isWorking = thinkingEvents.some(e => e.agent_id === ev.from && (e.status==='thinking'||e.status==='started'))
                      return (
                        <button key={ev.id || i}
                          onClick={() => navigateToAgent(ev.to === 'ceo' ? ev.from : ev.to, 'default')}
                          className={`w-full text-left rounded-lg p-2 border transition-colors hover:bg-app-elevated/60 ${isWorking ? 'border-yellow-500/20 bg-yellow-500/5' : 'border-app-elevated'}`}>
                          <div className="flex items-center gap-1.5 mb-0.5">
                            {isWorking && <span className="w-1.5 h-1.5 bg-yellow-400 rounded-full animate-pulse shrink-0"/>}
                            <span className="text-sm">{fromAg?.icon||'🤖'}</span>
                            <span className="text-[10px] font-medium text-text-secondary">{fromAg?.name||ev.from}</span>
                            <span className="text-text-dim text-[8px]">→</span>
                            <span className="text-sm">{toAg?.icon||'🤖'}</span>
                            <span className="text-[10px] font-medium text-text-secondary">{toAg?.name||ev.to}</span>
                            <span className={`ml-auto text-[9px] ${ev.action === 'delegate' ? 'text-warning' : ev.action === 'result' ? 'text-success' : 'text-text-dim'}`}>
                              {ev.action === 'delegate' ? '📋' : ev.action === 'result' ? '✅' : ev.action === 'reply' ? '💬' : '⚡'}
                            </span>
                          </div>
                          <div className="text-[10px] text-text-dim line-clamp-2 ml-5">{ev.content || ''}</div>
                          <div className="text-[8px] text-text-dim/50 mt-0.5 ml-5">{fmtTime(ev.ts)}</div>
                        </button>
                      )
                    })
                  )}
                </div>
              )}

              {/* Tab: Projects */}
              {drawerTab === 'projects' && (
                <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
                  <div className="text-[10px] text-text-dim">Current project: <span className="text-text-primary font-medium">{currentProject}</span></div>
                  {allProjects.filter(p => p !== 'default').map(p => (
                    <button key={p} onClick={async () => {
                      try {
                        await fetch(`${API}/api/project`, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({name:p})})
                        const d = await (await fetch(`${API}/api/project`)).json()
                        setCurrentProject(d.current || p); setAllProjects(d.projects || [])
                        setMessages([]); switchToSession(activeAgent, activeSession?.sessionId || 'default')
                      } catch(_) {}
                    }}
                      className={`w-full text-left px-3 py-2 rounded-lg text-xs transition-colors ${p === currentProject ? 'bg-accent/10 text-accent border border-accent/20' : 'text-text-secondary hover:bg-app-elevated border border-transparent'}`}>
                      <div className="font-medium">{p.replace(/_/g, ' ')}</div>
                      <div className="text-[9px] text-text-dim mt-0.5">Click to switch</div>
                    </button>
                  ))}
                  {allProjects.length <= 1 && <div className="text-center py-4 text-text-dim text-[10px]">No projects yet. Click ✦ to create one.</div>}
                </div>
              )}
            </div>
          </>
        )}
      </div>
      {/* BOTTOM BACKEND LOG CONSOLE */}
      <div className="bg-app-surface border-t border-app-elevated shrink-0 overflow-hidden" onClick={()=>{setShowConsole(true)}}>
        {/* Status row */}
        <div className="flex items-center gap-2 px-3 py-1 text-[10px] overflow-x-auto border-b border-app-elevated/40">
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${healthOk && connected?'bg-success':'bg-error'}`} title={healthOk?'backend online':'offline'} />
          <span className="text-gray-600 shrink-0">{wsStatus}</span>
          <span className="text-gray-700 shrink-0">·</span>
          {allEngines.filter(e => e.status === 'active').slice(0, 3).map(e => (
            <span key={e.id} className="flex items-center gap-1 shrink-0" title={e.name}>
              <span className="w-1 h-1 bg-success rounded-full" />
              <span className="text-gray-500 text-[8px]">{e.id}</span>
            </span>
          ))}
          <span className="text-gray-700 shrink-0">·</span>
          {agents.slice(0, 8).map(a => {
            const isWorking = thinkingEvents.some(e => e.agent_id === a.id && (e.status==='thinking'||e.status==='started'||e.status==='synthesizing'))
            const secsSinceEvent = lastSeenPerAgent[a.id]
            const isUnresponsive = typeof secsSinceEvent === 'number' && secsSinceEvent > 60
            const isWaiting = typeof secsSinceEvent === 'number' && secsSinceEvent > 30
            let dotColor = 'bg-text-dim/30'
            if (isWorking || isWaiting) dotColor = 'bg-amber-400' + (isWorking ? ' animate-pulse' : '')
            if (isUnresponsive) dotColor = 'bg-red-500 animate-pulse'
            if (isWorking) dotColor = 'bg-amber-400 animate-pulse'
            return (
              <span key={a.id} className="flex items-center gap-1 shrink-0" title={`${a.name}: ${isWorking?'working':isUnresponsive?'unresponsive ('+secsSinceEvent+'s)':isWaiting?'waiting ('+secsSinceEvent+'s)':'idle'}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${dotColor}`} />
                <span className="text-gray-500">{a.icon}</span>
              </span>
            )
          })}
          <span className="text-gray-600 shrink-0">+{Math.max(0, agents.length - 8)}</span>
          <span className="text-gray-700 shrink-0 text-[8px]">{liveEvents.length} events</span>
          <div className="ml-auto flex items-center gap-1 shrink-0">
            <span className="text-gray-600 cursor-pointer hover:text-gray-300 text-[9px]">▴ expand</span>
          </div>
        </div>
        {/* Live backend log feed */}
        <div className="h-20 overflow-y-auto px-3 py-1 space-y-0.5 font-mono text-[9px]">
          {liveEvents.length === 0 ? (
            <div className="text-gray-700 italic py-2">Waiting for backend activity...</div>
          ) : (
            [...liveEvents].reverse().slice(0, 8).map((ev, i) => {
              const ts = ev.ts ? fmtTime(ev.ts) : ''
              let prefix = '', color = 'text-gray-500'
              switch (ev._liveType) {
                case 'engine_call': prefix = '⚡'; color = 'text-blue-400'; break
                case 'tool_exec': prefix = '🔧'; color = 'text-amber-400'; break
                case 'api_request': prefix = '📡'; color = 'text-purple-400'; break
                case 'thinking': prefix = '⏳'; color = 'text-amber-400'; break
                case 'complete': prefix = '✅'; color = 'text-green-400'; break
                case 'error': prefix = '❌'; color = 'text-red-400'; break
                case 'comm':
                  const fa = agents.find(x => x.id === ev.from)
                  const ta = agents.find(x => x.id === ev.to)
                  prefix = `${fa?.icon||'🤖'} ${ev.from} → ${ta?.icon||'🤖'} ${ev.to}`
                  color = ev.action === 'delegate' ? 'text-amber-400' : ev.action === 'result' ? 'text-green-400' : 'text-gray-400'
                  break
                case 'progress': prefix = '🔧'; color = 'text-accent'; break
                default: prefix = '·'; break
              }
              const content = ev.content || ev.thought || ev.message || ev.tool || ev.text || ''
              const maxLen = content.length > 90 ? content.slice(0,90)+'…' : content
              return (
                <div key={i} className={`flex gap-2 ${color}`}>
                  <span className="text-gray-700 shrink-0 w-14">{ts}</span>
                  <span className="shrink-0">{prefix}</span>
                  <span className="truncate">{maxLen}</span>
                </div>
              )
            })
          )}
        </div>
      </div>
      {knowledgePanel}

      {/* RIGHT AGENT ACTIVITY SIDEBAR */}
      {showAgentSidebar && (
        <>
          <div className="fixed inset-0 z-40" onClick={()=>setShowAgentSidebar(false)} />
          <div className="fixed right-0 top-0 bottom-0 w-72 bg-app-surface/95 backdrop-blur-sm border-l border-app-elevated flex flex-col z-50 shadow-2xl shadow-black/50 animate-fade-in">
            <div className="px-3 py-2.5 border-b border-app-elevated flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2">
                <span className="text-text-secondary uppercase font-medium tracking-wider text-[10px]">Live Agents</span>
                {thinkingEvents.some(e => e.status !== 'complete' && e.status !== 'error') && (
                  <span className="flex items-center gap-1 text-accent/70 text-[9px]">
                    <span className="w-1.5 h-1.5 bg-accent rounded-full animate-pulse"/>live
                  </span>
                )}
              </div>
              <button onClick={()=>setShowAgentSidebar(false)} className="text-text-dim hover:text-text-primary transition-colors text-xs">✕</button>
            </div>

            {/* Agents sorted by most recent activity */}
            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {agents.length === 0 ? (
                <div className="text-center py-8 text-text-dim text-[10px]">No agents loaded</div>
              ) : (
                [...agents]
                  .sort((a, b) => {
                    const aLast = Math.max(...thinkingEvents.filter(e => e.agent_id === a.id).map(e => new Date(e.ts).getTime() || 0), 0)
                    const bLast = Math.max(...thinkingEvents.filter(e => e.agent_id === b.id).map(e => new Date(e.ts).getTime() || 0), 0)
                    return bLast - aLast
                  })
                  .map(a => {
                    const agentEvents = thinkingEvents.filter(e => e.agent_id === a.id)
                    const lastEvent = agentEvents[agentEvents.length - 1]
                    const isWorking = agentEvents.some(e => e.status === 'started' || e.status === 'thinking' || e.status === 'synthesizing')
                    const isError = agentEvents.some(e => e.status === 'error')
                    const isComplete = agentEvents.some(e => e.status === 'complete')
                    const perf = agentPerf[a.id]
                    const commsFrom = commEvents.filter(e => e.from === a.id).slice(-2)
                    const commsTo = commEvents.filter(e => e.to === a.id).slice(-2)
                    const lastComm = [...commsFrom, ...commsTo].sort((x, y) => (y.ts || '').localeCompare(x.ts || ''))[0]
                    const seenAgo = lastSeenPerAgent[a.id]
                    const agoText = typeof seenAgo === 'number' ? (seenAgo < 60 ? `${seenAgo}s` : `${Math.floor(seenAgo/60)}m`) : null

                    return (
                      <button key={a.id} onClick={() => setSelectedAgentDetail(a.id)}
                        className={`w-full text-left rounded-lg p-2.5 border transition-all duration-200 hover:bg-app-elevated/80 ${isWorking ? 'border-yellow-500/30 bg-yellow-500/5' : isError ? 'border-red-500/30 bg-red-500/5' : isComplete ? 'border-green-500/20 bg-green-500/5' : 'border-app-elevated bg-transparent'}`}>
                        <div className="flex items-center gap-2 mb-1">
                          {isWorking ? <span className="w-2 h-2 bg-yellow-400 rounded-full animate-pulse shrink-0"/> :
                           isError ? <span className="w-2 h-2 bg-red-500 rounded-full shrink-0"/> :
                           isComplete ? <span className="w-2 h-2 bg-green-500 rounded-full shrink-0"/> :
                           <span className="w-2 h-2 bg-text-dim/30 rounded-full shrink-0"/>}
                          <span className="text-sm">{a.icon}</span>
                          <span className="text-[11px] font-medium text-text-primary truncate">{a.name}</span>
                          {agoText && <span className="text-[8px] text-text-dim ml-auto">{agoText}</span>}
                        </div>
                        {lastEvent?.thought && (
                          <div className={`text-[10px] leading-relaxed line-clamp-2 ${isWorking ? 'text-yellow-300/70' : isError ? 'text-red-400' : 'text-text-dim'}`}>
                            {lastEvent.thought}
                          </div>
                        )}
                        {lastComm && (
                          <div className="text-[9px] text-text-dim/60 mt-0.5 flex items-center gap-1">
                            <span>{agents.find(x => x.id === lastComm.from)?.icon||'🤖'}</span>
                            <span className="truncate">→ {agents.find(x => x.id === lastComm.to)?.icon||'🤖'} {lastComm.action}</span>
                          </div>
                        )}
                        {perf && (
                          <div className="flex gap-2 mt-1 text-[8px] text-text-dim/50">
                            <span>{perf.avg}s avg</span>
                            {perf.fail_rate > 0 && <span className="text-red-400/60">{perf.fail_rate}% fails</span>}
                          </div>
                        )}
                      </button>
                    )
                  })
              )}
            </div>
          </div>
        </>
      )}

      {/* TOAST NOTIFICATIONS */}
      <div className="fixed bottom-16 right-4 z-50 flex flex-col gap-2 pointer-events-none">
        {toasts.map(t => (
          <div key={t.id}
            className={`pointer-events-auto px-4 py-2.5 rounded-lg shadow-xl border text-xs font-medium animate-fade-in transition-all duration-300 ${
              t.type === 'success' ? 'bg-green-900/90 border-green-500/40 text-green-300' :
              t.type === 'error' ? 'bg-red-900/90 border-red-500/40 text-red-300' :
              t.type === 'warning' ? 'bg-yellow-900/90 border-yellow-500/40 text-yellow-300' :
              'bg-gray-900/90 border-gray-700/60 text-gray-300'
            }`}>
            {t.msg}
          </div>
        ))}
      </div>

      {/* AGENT DETAIL MODAL */}
      {selectedAgentDetail && (() => {
        const a = agents.find(x => x.id === selectedAgentDetail)
        if (!a) { setTimeout(() => setSelectedAgentDetail(null), 0); return null }
        const ae = thinkingEvents.filter(e => e.agent_id === a.id)
        const lastEvent = ae[ae.length - 1]
        const isWorking = ae.some(e => e.status === 'started' || e.status === 'thinking' || e.status === 'synthesizing')
        const commsTo = commEvents.filter(e => e.to === a.id)
        const commsFrom = commEvents.filter(e => e.from === a.id)
        const perf = agentPerf[a.id]
        return (
          <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center" onClick={()=>setSelectedAgentDetail(null)}>
            <div className="bg-gray-900 border border-gray-700 rounded-xl w-[500px] max-w-[90vw] max-h-[80vh] flex flex-col" onClick={e=>e.stopPropagation()}>
              <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700 shrink-0">
                <div className="flex items-center gap-2">
                  <span className="text-xl">{a.icon}</span>
                  <div>
                    <div className="text-sm font-medium text-text-primary">{a.name}</div>
                    <div className="text-[10px] text-text-dim">{a.role}</div>
                  </div>
                  {isWorking && <span className="ml-2 text-[9px] text-yellow-400 animate-pulse">● LIVE</span>}
                </div>
                <button onClick={()=>setSelectedAgentDetail(null)} className="text-gray-500 hover:text-gray-300 text-xs">✕</button>
              </div>
              <div className="flex-1 overflow-y-auto p-3 space-y-3 text-xs">
                {/* Status */}
                <div className="flex gap-3">
                  <div className="bg-gray-800/60 rounded-lg px-3 py-2 flex-1 text-center">
                    <div className="text-text-dim text-[9px]">Status</div>
                    <div className={`font-medium mt-0.5 ${isWorking ? 'text-yellow-400' : lastEvent?.status === 'error' ? 'text-red-400' : lastEvent?.status === 'complete' ? 'text-green-400' : 'text-text-dim'}`}>
                      {isWorking ? 'Working' : lastEvent?.status === 'error' ? 'Error' : lastEvent?.status === 'complete' ? 'Done' : 'Idle'}
                    </div>
                  </div>
                  {perf && <div className="bg-gray-800/60 rounded-lg px-3 py-2 flex-1 text-center">
                    <div className="text-text-dim text-[9px]">Avg Time</div>
                    <div className="font-medium mt-0.5 text-accent">{perf.avg}s</div>
                  </div>}
                  {perf?.fail_rate !== undefined && <div className="bg-gray-800/60 rounded-lg px-3 py-2 flex-1 text-center">
                    <div className="text-text-dim text-[9px]">Fail Rate</div>
                    <div className="font-medium mt-0.5 text-red-400">{perf.fail_rate}%</div>
                  </div>}
                </div>

                {/* Recent Thinking */}
                <div>
                  <div className="text-[9px] text-text-dim uppercase tracking-wider font-medium mb-1.5">Recent Activity</div>
                  {ae.length === 0 ? (
                    <div className="text-text-dim/50 italic">No activity recorded</div>
                  ) : (
                    <div className="space-y-1 max-h-40 overflow-y-auto">
                      {[...ae].reverse().slice(0, 10).map((ev, i) => (
                        <div key={i} className="bg-gray-800/40 rounded px-2.5 py-1.5 border border-gray-800">
                          <div className="flex items-center gap-1.5 text-[10px]">
                            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${ev.status === 'error' ? 'bg-red-500' : ev.status === 'complete' ? 'bg-green-500' : ev.status === 'started' || ev.status === 'thinking' || ev.status === 'synthesizing' ? 'bg-yellow-400 animate-pulse' : 'bg-text-dim'}`}/>
                            <span className="text-text-dim">{ev.status}</span>
                            <span className="text-text-dim/50 ml-auto">{fmtTime(ev.ts)}</span>
                          </div>
                          <div className="text-[10px] text-text-dim/80 mt-0.5 line-clamp-2">{ev.thought}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Communications */}
                <div>
                  <div className="text-[9px] text-text-dim uppercase tracking-wider font-medium mb-1.5">Recent Communications</div>
                  {commsTo.length === 0 && commsFrom.length === 0 ? (
                    <div className="text-text-dim/50 italic">No communications yet</div>
                  ) : (
                    <div className="space-y-1 max-h-32 overflow-y-auto">
                      {[...commsTo, ...commsFrom].sort((x, y) => (y.ts || '').localeCompare(x.ts || '')).slice(0, 8).map((ev, i) => {
                        const fromAg = agents.find(x => x.id === ev.from)
                        const toAg = agents.find(x => x.id === ev.to)
                        return (
                          <div key={i} className="bg-gray-800/40 rounded px-2.5 py-1.5 border border-gray-800 text-[10px]">
                            <span className="text-gray-500">{fromAg?.icon||'🤖'} {ev.from}</span>
                            <span className="text-gray-600 mx-1">→</span>
                            <span className="text-gray-500">{toAg?.icon||'🤖'} {ev.to}</span>
                            <span className={`ml-1 ${ev.action === 'delegate' ? 'text-yellow-400' : ev.action === 'result' ? 'text-green-400' : 'text-text-dim'}`}>{ev.action}</span>
                            <div className="text-text-dim/60 mt-0.5 line-clamp-1">{ev.content?.slice(0, 100) || ''}</div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>

                {/* Tools used */}
                <div>
                  <div className="text-[9px] text-text-dim uppercase tracking-wider font-medium mb-1.5">Agent Details</div>
                  <div className="bg-gray-800/40 rounded px-3 py-2 border border-gray-800 text-[10px] space-y-1">
                    <div className="flex justify-between"><span className="text-text-dim">ID</span><span className="text-text-primary">{a.id}</span></div>
                    <div className="flex justify-between"><span className="text-text-dim">Role</span><span className="text-text-primary">{a.role}</span></div>
                    <div className="flex justify-between"><span className="text-text-dim">Events</span><span className="text-text-primary">{ae.length}</span></div>
                    {perf && <div className="flex justify-between"><span className="text-text-dim">Total Calls</span><span className="text-text-primary">{perf.calls || 0}</span></div>}
                  </div>
                </div>

                {/* Navigate to chat */}
                <button onClick={() => { setSelectedAgentDetail(null); switchAgent(a.id) }}
                  className="w-full bg-accent/10 hover:bg-accent/20 text-accent border border-accent/20 rounded-lg px-3 py-2 text-xs font-medium transition-colors">
                  💬 Open {a.name} Chat
                </button>
              </div>
            </div>
          </div>
        )
      })()}

      {/* AGENT CONSOLE */}
      {showConsole && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center" onClick={()=>setShowConsole(false)}>
          <div className="bg-gray-900 border border-gray-700 rounded-xl w-[700px] max-w-[95vw] max-h-[85vh] flex flex-col" onClick={e=>e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700 shrink-0">
              <div className="flex gap-4">
                <button onClick={()=>setConsoleTab('activity')}
                  className={`text-xs font-medium pb-1 border-b-2 transition-colors ${consoleTab==='activity'?'text-emerald-400 border-emerald-400':'text-gray-500 border-transparent hover:text-gray-300'}`}>
                  ⚡ Activity
                </button>
                <button onClick={()=>setConsoleTab('backendlog')}
                  className={`text-xs font-medium pb-1 border-b-2 transition-colors ${consoleTab==='backendlog'?'text-emerald-400 border-emerald-400':'text-gray-500 border-transparent hover:text-gray-300'}`}>
                  📜 Backend Log
                </button>
                <button onClick={()=>setConsoleTab('commlog')}
                  className={`text-xs font-medium pb-1 border-b-2 transition-colors ${consoleTab==='commlog'?'text-emerald-400 border-emerald-400':'text-gray-500 border-transparent hover:text-gray-300'}`}>
                  📋 Comm Log
                </button>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => {
                  const el = document.getElementById('console-tab-content')
                  if (!el) return
                  const text = el.innerText || el.textContent || ''
                  navigator.clipboard.writeText(text).then(() => {
                    addToast('📋 Console tab copied', 'success')
                  }).catch(() => {})
                }} className="text-[10px] text-gray-500 hover:text-gray-300 transition-colors" title="Copy tab content">📋</button>
                <button onClick={()=>setShowConsole(false)} className="text-gray-500 hover:text-gray-300 text-xs">✕</button>
              </div>
            </div>

            {consoleTab === 'activity' && (
              <div id="console-tab-content" className="flex-1 overflow-y-auto p-3">
                <div className="grid grid-cols-3 md:grid-cols-4 gap-2">
                  {agents.map(a => {
                    const th = thinkingEvents.filter(e => e.agent_id === a.id)
                    const lastEvent = th[th.length - 1]
                    const isWorking = th.some(e => e.status === 'started' || e.status === 'thinking' || e.status === 'synthesizing')
                    const isError = th.some(e => e.status === 'error')
                    const isComplete = th.some(e => e.status === 'complete')
                    const perf = agentPerf[a.id]
                    const toolSteps = collabEvents.filter(e => e.type === 'agent_tool_step' && e.agent_id === a.id && e.status === 'started')
                    const currentTool = toolSteps.length > 0 ? toolSteps[toolSteps.length - 1]?.tool : null
                    return (
                      <div key={a.id} className={`rounded-lg border p-2.5 transition-all ${isWorking ? 'border-yellow-500/40 bg-yellow-500/5' : isError ? 'border-red-500/40 bg-red-500/5' : isComplete ? 'border-green-500/30 bg-green-500/5' : 'border-gray-700/50 bg-gray-800/30'}`}>
                        <div className="flex items-center gap-2 mb-1">
                          {isWorking ? <span className="w-2 h-2 bg-yellow-400 rounded-full animate-pulse shrink-0"/> :
                           isError ? <span className="w-2 h-2 bg-red-500 rounded-full shrink-0"/> :
                           isComplete ? <span className="w-2 h-2 bg-green-500 rounded-full shrink-0"/> :
                           <span className="w-2 h-2 bg-gray-600 rounded-full shrink-0"/>}
                          <span className="text-sm">{a.icon}</span>
                          <span className="text-[11px] font-medium text-gray-200 truncate">{a.name}</span>
                          {isWorking && <span className="text-[9px] text-yellow-400 ml-auto animate-pulse">LIVE</span>}
                        </div>
                        <div className="text-[9px] text-gray-500 space-y-0.5 ml-5">
                          {isWorking && lastEvent && <div className="text-yellow-300/80 truncate">{lastEvent.thought?.slice(0,80)||'working...'}</div>}
                          {isError && <div className="text-red-400">error</div>}
                          {isComplete && lastEvent?.duration_s && <div className="text-green-400">{lastEvent.duration_s}s</div>}
                          {currentTool && <div className="text-amber-400/70">🔧 {currentTool}</div>}
                          {perf && (
                            <div className="flex gap-2 mt-0.5">
                              <span className={perf.avg < 25 ? 'text-green-500' : perf.avg < 60 ? 'text-yellow-500' : 'text-red-400'}>
                                {perf.avg}s avg
                              </span>
                              {perf.fail_rate > 0 && <span className="text-red-400">{perf.fail_rate}% fails</span>}
                            </div>
                          )}
                          {!isWorking && !isComplete && !isError && !perf && <span className="text-gray-600">idle</span>}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {consoleTab === 'backendlog' && (
              <div id="console-tab-content" className="flex-1 overflow-y-auto p-3">
                <div className="mb-2 flex items-center gap-2 text-[10px] text-gray-600">
                  <span>{liveEvents.length} events</span>
                  <button onClick={() => setLiveEvents([])} className="text-gray-600 hover:text-red-400 transition-colors">clear</button>
                </div>
                <div className="space-y-0.5 font-mono text-[9px]">
                  {liveEvents.length === 0 ? (
                    <div className="text-center py-8 text-gray-600 text-xs">No backend events yet. Send a message to trigger activity.</div>
                  ) : (
                    [...liveEvents].reverse().map((ev, i) => {
                      const ts = ev.ts ? fmtTime(ev.ts) : ''
                      let icon = '·', color = 'text-gray-500', agentLabel = ''
                      switch (ev._liveType) {
                        case 'engine_call': icon = '⚡'; color = 'text-blue-400'; break
                        case 'tool_exec': icon = '🔧'; color = 'text-amber-400'; break
                        case 'api_request': icon = '📡'; color = 'text-purple-400'; break
                        case 'thinking': icon = '⏳'; color = 'text-amber-400'; break
                        case 'complete': icon = '✅'; color = 'text-green-400'; break
                        case 'error': icon = '❌'; color = 'text-red-400'; break
                        case 'comm':
                          const fa = agents.find(x => x.id === ev.from)
                          const ta = agents.find(x => x.id === ev.to)
                          icon = `${fa?.icon||'🤖'} ${ev.from}→${ta?.icon||'🤖'}`
                          color = ev.action === 'delegate' ? 'text-amber-400' : ev.action === 'result' ? 'text-green-400' : 'text-gray-400'
                          break
                        case 'progress': icon = '🔧'; color = 'text-accent'; break
                        default: icon = '·'; break
                      }
                      if (ev.agent_id && ev._liveType !== 'comm') {
                        const ag = agents.find(x => x.id === ev.agent_id)
                        agentLabel = ag ? `${ag.icon||''} ` : ''
                      }
                      const content = ev.content || ev.thought || ev.message || ev.tool || ev.text || ''
                      return (
                        <div key={i} className={`flex gap-2 ${color} hover:bg-gray-800/30 rounded px-1 py-0.5`}>
                          <span className="text-gray-700 shrink-0 w-14">{ts}</span>
                          <span className="shrink-0 w-16 text-[8px] text-gray-700">{ev._liveType||''}</span>
                          <span className="shrink-0">{icon}</span>
                          <span className="text-gray-600 shrink-0">{agentLabel}</span>
                          <span className="truncate">{content}</span>
                          {ev.engine_id && <span className="text-gray-700 shrink-0 ml-auto">[{ev.engine_id}]</span>}
                          {ev.duration_s && <span className="text-gray-700 shrink-0">({ev.duration_s}s)</span>}
                        </div>
                      )
                    })
                  )}
                </div>
              </div>
            )}

            {consoleTab === 'commlog' && (
              <div id="console-tab-content" className="flex-1 overflow-y-auto p-3 space-y-1">
                {commEvents.length === 0 ? (
                  <div className="text-center py-8 text-gray-600 text-xs">No communication yet. Send a task to CEO to see agent interactions.</div>
                ) : (
                  [...commEvents].reverse().slice(0, 200).map((ev, i) => {
                    const fromAg = agents.find(x => x.id === ev.from)
                    const toAg = agents.find(x => x.id === ev.to)
                    const comm = typeof ev.content === 'string' ? ev.content.slice(0, 120) : ''
                    return (
                      <div key={ev.id || i} className="flex items-start gap-2 py-1.5 px-2 rounded hover:bg-gray-800/50 text-[10px]">
                        <span className="text-gray-500 font-mono shrink-0 w-20 text-right">{fmtTime(ev.ts)}</span>
                        <span className="shrink-0">{fromAg?.icon||'🤖'} {ev.from}</span>
                        <span className="text-gray-600 shrink-0">→</span>
                        <span className="shrink-0">{toAg?.icon||'🤖'} {ev.to}</span>
                        <span className={`truncate ${ev.action === 'delegate' ? 'text-yellow-400' : ev.action === 'result' || ev.action === 'reply' ? 'text-green-400' : 'text-gray-400'}`}>
                          {ev.action === 'delegate' ? '📋' : ev.action === 'result' || ev.action === 'reply' ? '✅' : '💬'} {ev.action}: {comm}
                        </span>
                      </div>
                    )
                  })
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default App
