# Changelog

## [2.0.0] — Enterprise-Grade Refactoring Sprint (11.5h)

### Day 1 — Modular Architecture
- **Split main.py** (1417→65 lines) into 8 router modules under `routers/`
- **Created `shared.py`** (~400 lines): AgentContext, run_agent, GREEK_LANG, models, helpers, all shared globals
- **8 routers**: chat, agents, sessions, files, projects, knowledge, scheduler_routes, admin
- Zero circular imports, 72 routes total

### Day 2 — Summary Injection + File I/O Locking
- **Context compression**: `_make_summary_block()` condenses old messages into summary when >8
- **Memory summaries injected** into AgentContext system prompt from `get_summaries()`
- **Thread-safe file I/O**: `_project_lock`, `_session_file_lock` in shared.py; `_memory_lock` in memory_summary.py
- Helper functions: `_load_session_file()`, `_save_session_file()`, `_merge_session_messages()`

### Day 3 — Error Normalization + Health Endpoint
- **Custom exception handler** with Greek error messages:
  - 429: "Πολλά αιτήματα — παρακαλώ περιμένετε λίγο"
  - 404: "Δεν βρέθηκε αυτό που ζητάτε."
  - 500: "Προέκυψε ένα εσωτερικό σφάλμα"
- **Health endpoint enhanced**: uptime, active_sessions, active_engines, engine list

### Day 4 — Test Suite
- **45 pytest tests** across 5 files:
  - `test_engines.py` (8): scoring, filtering, performance recording
  - `test_agents.py` (11): prompts, routing, delegation validation
  - `test_tools.py` (12): execution, XML parsing, error handling
  - `test_api.py` (15): 20 endpoints with TestClient
  - `test_shared.py` (11): summary injection, file locking, caching

### Day 5 — Rate Limiting
- **In-memory rate limiter**: 30 requests per 60s per IP
- Clean 429 JSON response with Greek message
- Zero external dependencies

### Day 6 — Input Sanitization
- **30 injection patterns** blocked: prompt injection, DAN, role-switching, system prompt reveal
- Sanitization at 3 levels: POST `/api/chat`, WebSocket handler, HTTP middleware
- `detect_injection()` function in shared.py

### Day 7 — Packaging + CLI + Graceful Shutdown
- **`setup.py`**: entry points, install_requires, extras_require[dev]
- **`aionctl` CLI**: start, stop, restart, status, logs
- **Graceful shutdown**: waits for pending engine calls before exit
- **`requirements.txt`** updated with all dependencies

## [Unreleased] — Major Upgrade

### Removed
- **Approval system** — `backend/approval.py` deleted entirely
  - `request_approval` / `approve_request` tools removed from all agents
  - All API endpoints for approval removed
  - Frontend approval UI (modals, buttons) removed
  - All agent prompts updated: "ζήτα έγκριση" → "επικοινώνησε απευθείας"
  - CEO no longer acts as approval manager
  - `get_team_overview()`: "ΔΕΝ χρειάζεται έγκριση από CEO"

### Added
- **Engines** (3 new OpenRouter + ollama restored):
  - `openrouter_qwen` — fast, tools-enabled, priority 3
  - `openrouter_gemma` — fast, tools-enabled, priority 4
  - `openrouter_nemotron` — medium, simple-only, priority 8 (degraded Greek)
  - `ollama` — restored as low-priority fallback (slow, simple-only, priority 9)
- **Auto mode** (♾️ button):
  - Sends "αυτόνομη συνέχεια..." with original prompt after 3s delay
  - Loop continues until user clicks Stop
  - CEO system prompt extended with auto-mode instructions
- **Minimal UI** (`minimal-ui/index.html`):
  - Standalone alternative GUI on port 5175
  - Engine strip + health check + live agent sidebar
  - Toast notifications, agent detail modal, comm tab
- **PM Agent auto-initialization**:
  - Auto-creates `projects.json` with rich structure from `MEMORY/project.json`
  - Projects include: name, status, phase, milestones, agents_involved
  - Auto-triggered by CEO when project/phase completes
- **get_agent_history tool** — reads last 10 session files for a given agent
- **AgentBus.engine_cache** — per-agent cached engine for sub-agent calls
- **Session engine cache** — once engine works, cached for the session
- **Greek language constant** (`GREEK_LANG`) injected into all AgentContext + sub-agent prompts
- **Word formatting rules** — Content Agent + Documentation Specialist prompts
- **Rate limits & fallback keys** for all 12 engines
- **Toast notification system** for agent events in frontend
- **Agent detail modal** — click agent in sidebar for info
- **Comm tab** — agent-to-agent communication view in context drawer
- **Right retractable sidebar** — Live agent activity (toggled by L key)

### Changed
- **Engine scoring overhaul**:
  - Speed weight: `(6-speed)*2000` (very_fast=+10000, fast=+8000, medium=+6000, slow=+4000)
  - `get_active_engines()` always sorts by score descending
  - Session cache puts cached engine first in full fallback list
- **Engine downgrades** (degraded Greek quality):
  - `sambanova` → slow, no tools, priority 9
  - `openrouter_nemotron` → medium, simple-only, priority 8
  - `ollama` → slow, simple-only, priority 9
- **Timeouts reduced**:
  - Non-streaming: 15s, Streaming: 25s
- **Cooldowns increased**:
  - 429 cooldown: 120s→180s (engine level), 60s→300s (main.py level)
  - Quota exhausted: 3600s→7200s
- **Task types**:
  - CEO/sub-agents use `reasoning` for user-facing responses
  - Agent-to-agent calls use `simple`/`general`
- **Single-call optimization** — `run_sub_agent()` uses single LLM call for simple tasks
- **CEO routing** — auto-detect topic → delegate (17 topics mapped)
- **Parallel delegation** — `parallel_delegate` with `ThreadPoolExecutor` for concurrent agent execution
- **Frontend**:
  - Engine strip + health check + connection stats ported from minimal UI
  - Auto-expand textbox
  - Send button right after text input
  - Word wrap: `word-break: break-word`, `overflow-wrap: break-word`
  - HTML rendering: regex test `/<\\/?[a-zA-Z][^>]*>/` for tool_result + assistant messages
  - `renderMd()` markdown renderer for plain text fallback
  - `.msg-bubble`, `.render-html` CSS styles
  - All sidebars scroll as unified containers

### Enhanced
- **`parse_xml_tool_calls()`** — supports `<|tool_call|>` JSON format + 4 XML formats
- **`sanitize_messages()`** — strips `ts` and non-standard fields before API calls
- **Auto-expire stale cooldowns** — in `load_engine_status()`
- **`get_team_overview()`** — now lists 17 agents (was 15), includes PM Agent + Content Agent
- **Content Agent prompt** — full rewrite with word formatting rules
- **SettingsPanel** — API key editing, engine/perf display
- **FileBrowser** — file preview + delete
- **LeadsPanel** — search/filter
- **BUILDER_CONTEXT.md** — updated with all changes and pending tasks

### Fixed
- **CSV export** — 5 columns (Agent, Date, Role, Timestamp, Message), ISO 8601, UTF-8 without BOM, tool calls stripped
- **Sub-agent engine selection** — `get_active_engines(task_type=task_type, needs_tools=True)` (was called with no args)
- **Context isolation** — chat history per session
- **Streaming** — non-streaming first call for tool_calls
- **Memory lock** — `threading.Lock()` wraps `load_memory`/`save_memory`
- **web_fetch retry** — 3 attempts with 1s/2s/4s backoff for 429/503
- **Session save** — merge (append, never overwrite)

### Local & VPS Deployment
- **`scripts/deploy/deploy-local.sh`** — macOS local deployment
  - Installs Python deps, builds frontend
  - Creates launchd service (auto-start on boot)
  - Checks ngrok token for remote access
- **`scripts/deploy/com.aionclaw.backend.plist`** — macOS launchd plist (auto-restart, logging)
- **`scripts/deploy/deploy.sh`** — one-command VPS setup on Ubuntu 24.04
  - Installs Python, Node, Nginx, certbot, UFW, fail2ban
  - Clones repo, builds frontend, installs deps
  - Configures Nginx reverse proxy with SSL (Let's Encrypt)
  - Creates systemd service with auto-restart
  - Hardens security: firewall (22/80/443), fail2ban, no-new-privileges
- **`scripts/deploy/aionclaw.service`** — systemd unit with ProtectSystem, PrivateTmp
- **`scripts/deploy/aionclaw.nginx`** — Nginx config: HTTPS redirect, SSL ciphers, security headers, WebSocket support
- Supports custom domain with automated SSL
- Data dir (`~/AION/`) lives separately from app code for persistence

### New Engines (total: 12)
| Engine | Speed | Tools | Priority |
|--------|-------|-------|----------|
| cerebras | very_fast | yes | 1 |
| openrouter_deepseek | fast | yes | 2 |
| openrouter_qwen | fast | yes | 3 |
| openrouter_gemma | fast | yes | 4 |
| openrouter | medium | yes | 5 |
| openrouter_llama | medium | yes | 6 |
| groq | medium | yes | 7 |
| groq_8b | medium | yes | 7 |
| openrouter_nemotron | medium | simple-only | 8 |
| gemini | medium | yes | 8 |
| sambanova | slow | no | 9 |
| ollama | slow | simple-only | 9 |
