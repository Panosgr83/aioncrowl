# AIONCLAW — Multi-Agent AI System

[![Python](https://img.shields.io/badge/Python-3.10%2B-blue)](https://python.org)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.110%2B-009688)](https://fastapi.tiangolo.com)
[![License](https://img.shields.io/badge/License-MIT-green)](LICENSE)

**AIONCLAW** is an enterprise-grade, ultra-fast multi-agent AI system with **18 specialized agents**, intelligent engine routing, multi-bot Telegram integration, and a responsive web UI. Designed for production — deployed on DigitalOcean with Nginx reverse proxy.

---

## Features

- **18 Specialized Agents** — CEO, Offers, Support, LeadFinder, Developer, Writer, Analyst, Researcher, Editor, Translator, Summarizer, Architect, Strategist, Designer, Investigator, Planner, Reporter, PM
- **Ultra-Compact Protocol** — `TASK|CONTEXT|TOOLS` format saves 60-70% tokens vs natural language
- **Intelligent Engine Routing** — 6 active engines with scoring, fallback chain, quota management
- **Multi-Bot Telegram** — One bot per project (`@AionWebBot`, `@AngelusPastryBot`, etc.) with live event push
- **24/7 Autonomous Mode** — Background CEO loop per-project, toggleable from web UI + Telegram
- **File Generation** — Office documents (.doc), session export
- **Persistent WebSocket** — Real-time streaming, tool execution, agent activity
- **Responsive Mobile UI** — iOS/Android optimized, dark mode, agent selection modal
- **Greek Language** — CEO writes in natural modern Greek, agent communication in English

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                     Frontend (React)                  │
│            WebSocket  ←→  REST API                    │
├─────────────────────────────────────────────────────┤
│                    Backend (FastAPI)                   │
├───────────┬──────────┬──────────┬───────────────────┤
│  Router:  │ Router:  │ Router:  │  Router:           │
│   chat    │  agents  │ sessions │   files            │
├───────────┼──────────┼──────────┼───────────────────┤
│ Router:   │ Router:  │ Router:  │  Router:           │
│ projects  │knowledge │scheduler │   admin            │
├───────────┴──────────┴──────────┴───────────────────┤
│                    Shared Layer                       │
│   AgentContext · run_agent · trim_messages · locking  │
├─────────────────────────────────────────────────────┤
│              Agent System (18 agents)                 │
│   CEO → routes to specialists via compact protocol    │
├─────────────────────────────────────────────────────┤
│              Engine Layer (6 active)                   │
│   cerebras · groq · openrouter_deepseek · sambanova   │
│   openrouter_qwen · openrouter_llama                  │
│   + engine_router.py (quota management, cooldowns)    │
├─────────────────────────────────────────────────────┤
│         Background Systems                            │
│   Telegram Bot Manager · Scheduler · Engine Router    │
│   Memory/Summary · File I/O with thread locking       │
└─────────────────────────────────────────────────────┘
```

---

## Quick Start

### Prerequisites

- Python 3.10+
- Node.js 18+
- API keys (see [Configuration](#configuration))

### Installation

```bash
# Clone repository
git clone https://github.com/anomalyco/aionclaw.git
cd aionclaw

# Backend setup
python3 -m venv venv
source venv/bin/activate
pip install -r backend/requirements.txt

# Frontend setup
cd frontend
npm install
npm run build
cd ..

# Configuration
cp .env.example .env
# Edit .env with your API keys
```

### Run

```bash
# Using CLI (recommended)
aionctl start

# Or directly
cd backend
python3 -m uvicorn main:app --host 127.0.0.1 --port 9789
```

---

## CLI Usage

```bash
# Start server
aionctl start              # default port 9789
aionctl start 9790         # custom port

# Stop gracefully
aionctl stop

# Restart
aionctl restart

# Check status
aionctl status

# View logs
aionctl logs               # last 50 lines
aionctl logs 100           # last 100 lines
```

---

## Configuration

### API Keys (`.env`)

```bash
# Required
CEREBRAS_API_KEY=your_key
GROQ_API_KEY=your_key
OPENROUTER_API_KEY=your_key
SAMBANOVA_API_KEY=your_key

# Optional
GEMINI_API_KEY=your_key

# Telegram (one per project)
TELEGRAM_BOT_DEFAULT=123456:ABC-DEF1234
TELEGRAM_BOT_ANGELUS_PASTRY=123456:ABC-DEF1234
TELEGRAM_CHAT_ID=123456789
```

### Engine Scoring

| Engine | Score Bonus | Tools | Speed |
|--------|-------------|-------|-------|
| cerebras | +2000 | ✅ | very_fast |
| gemini | +1500 | ✅ | medium |
| groq | +500 | ✅ | medium |
| sambanova | +300 | ❌ | slow |
| openrouter_deepseek | +200 | ✅ | fast |
| openrouter (free) | -2000 | varies | varies |

---

## API Reference

### Core Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/chat` | Send message to agent |
| WS | `/ws/chat` | Real-time chat with streaming |
| WS | `/ws/collab` | Collaboration events stream |

### Agent Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/agents` | List all agents |
| GET | `/api/engines` | List active engines |
| GET | `/api/agent-heartbeat` | Last seen timestamps |

### Session Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/sessions` | List active sessions |
| GET | `/api/sessions/{key}/load` | Load session messages |
| POST | `/api/sessions/{key}/save` | Save session messages |
| GET | `/api/export/doc` | Export session as Word document |

### Project Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/projects` | List projects |
| GET | `/api/project` | Get current project |
| POST | `/api/project` | Set/switch project |
| DELETE | `/api/project/{name}` | Delete project |

### File Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/upload` | Upload file |
| GET | `/api/files/{agent}` | List agent files |
| GET | `/api/files/read` | Read file content |
| DELETE | `/api/files/{agent}/{file}` | Delete file |

### Admin Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | System health + uptime |
| GET | `/api/performance` | Agent performance stats |
| GET | `/api/engine-perf` | Engine performance stats |
| GET | `/api/activity` | Activity log |
| GET | `/api/keys` | List API keys (masked) |
| POST | `/api/keys` | Update API key |

### Scheduler & Auto Mode

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/scheduler/jobs` | List scheduled jobs |
| POST | `/api/scheduler/add` | Add interval job |
| POST | `/api/scheduler/cron` | Add cron job |
| GET | `/api/auto/status` | Auto mode status |
| POST | `/api/auto/toggle` | Toggle 24/7 auto mode |

---

## Testing

```bash
# Install test dependencies
pip install pytest httpx

# Run all tests
pytest

# With coverage
pytest --cov=backend --cov-report=html

# Specific test file
pytest tests/test_engines.py -v
```

**45 tests across 5 files:**

| File | Tests | Coverage |
|------|-------|----------|
| `test_engines.py` | 8 | Scoring, filtering, performance |
| `test_agents.py` | 11 | Prompts, routing, delegation |
| `test_tools.py` | 12 | Execution, XML parsing, error handling |
| `test_api.py` | 15 | All endpoints with TestClient |
| `test_shared.py` | 11 | Summary injection, locking, caching |

---

## Deployment

### VPS (DigitalOcean)

```bash
# One-command deploy
bash scripts/deploy/deploy.sh

# This installs:
# - Python + Node.js
# - Nginx reverse proxy (port 80)
# - Systemd service (auto-restart)
# - UFW firewall (22, 80, 443)
# - Fail2ban
```

### macOS (Local)

```bash
# Launchd service (auto-start on boot)
bash scripts/deploy/deploy-local.sh
```

### Manual

```bash
# On VPS
scp -r backend/* root@your-vps:/opt/aionclaw/backend/
ssh root@your-vps "systemctl restart aionclaw"
```

---

## Project Structure

```
aionclaw/
├── backend/
│   ├── main.py                 # App bootstrap (65 lines)
│   ├── shared.py               # Shared logic: AgentContext, run_agent, locking
│   ├── aionctl.py              # CLI tool
│   ├── setup.py                # Python packaging
│   ├── config.py               # Centralized paths
│   ├── engine/                 # Engine definitions + API calls
│   ├── engine_router.py        # Quota management + auto-switching
│   ├── routers/                # Route modules (8 files)
│   │   ├── chat.py             # Chat + WebSocket
│   │   ├── agents.py           # Agent/engine listing
│   │   ├── sessions.py         # Session CRUD
│   │   ├── files.py            # File operations
│   │   ├── projects.py         # Project management
│   │   ├── knowledge.py        # KB/CRM/Leads
│   │   ├── scheduler_routes.py # Scheduler + auto mode
│   │   └── admin.py            # Admin endpoints
│   ├── agents.py               # 18 agent definitions
│   ├── collaboration.py        # AgentBus, sub-agent execution
│   ├── telegram_bot.py         # Multi-bot Telegram system
│   ├── scheduler.py            # APScheduler integration
│   ├── memory_summary.py       # Memory + summarization
│   ├── tools/__init__.py       # Tool definitions + execution
│   ├── tests/                  # 45 pytest tests
│   └── kb.py                   # Knowledge base indexing
├── frontend/
│   ├── src/                    # React source
│   │   ├── components/         # ChatInput, AgentPlanModal, FileBrowser
│   │   ├── App.jsx             # Main app (1985 lines)
│   │   └── index.css           # Mobile-responsive styles
│   └── dist/                   # Built frontend
├── scripts/deploy/             # Deployment scripts
│   ├── deploy.sh               # VPS one-command
│   ├── deploy-local.sh         # macOS launchd
│   ├── aionclaw.service        # Systemd unit
│   └── aionclaw.nginx          # Nginx config
├── .env.example                # Environment template
└── .gitignore
```

---

## Security

- **Rate Limiting** — 30 requests per 60s per IP
- **Input Sanitization** — 30 injection pattern blocks (prompt injection, DAN, role-switching)
- **API Key Auth** — Optional `x-api-key` header for all `/api/` routes
- **Tool Permissions** — Runtime whitelist per agent
- **File Isolation** — Path traversal protection on all file endpoints
- **Error Normalization** — No raw stack traces exposed; friendly Greek messages

---

## Agents

| ID | Name | Icon | Role |
|----|------|------|------|
| ceo | CEO | 👑 | Orchestrator, routes tasks |
| offers | Expert Offers | 💼 | Product/offer creation |
| support | Support | 🛟 | Quick answers |
| leadfinder | Lead Finder | 🔍 | Lead research |
| developer | Developer | 💻 | Code generation |
| writer | Content Writer | ✍️ | Greek content |
| analyst | Analyst | 📊 | Data analysis |
| researcher | Researcher | 🔬 | Deep research |
| editor | Editor | 📝 | Text polish |
| translator | Translator | 🌐 | GR↔EN |
| summarizer | Summarizer | 📋 | Summarization |
| architect | Architect | 🏗️ | System design |
| strategist | Strategist | 🎯 | Strategy |
| designer | Designer | 🎨 | Visual design |
| investigator | Investigator | 🕵️ | Root cause |
| planner | Planner | 📅 | Task planning |
| reporter | Reporter | 📊 | Report generation |
| pm | PM | 🗂️ | Project management |

---

## Telegram Multi-Bot

Each project gets its own Telegram bot:

| Bot | Project |
|-----|---------|
| `@AionDefaultBot` | default |
| `@AionWebBot` | web |
| `@AngelusPastryBot` | angelus_pastry |
| `@AngelikiSavvidakiBot` | angeliki_savvidaki |
| `@MelisanutsBot` | melisanuts |
| `@MikeArtisticTeamBot` | mike_artistic_team |

Messages merge into the project's main chat with `📱 [project]` prefix. Events (start/complete/error) are pushed live via event queue.

---

## Performance

| Metric | Typical |
|--------|---------|
| CEO simple response | 5-12s |
| CEO complex (with tools) | 20-45s |
| Agent-to-agent | 3-8s |
| Telegram event push | <2s |
| WS keepalive | 25s interval |
| Engine fallback chain | 5 max |
| Context messages | 6 (with summary compression) |

---

## Development

```bash
# Backend dev mode
cd backend
python3 -m uvicorn main:app --host 127.0.0.1 --port 9789 --reload

# Frontend dev mode
cd frontend
npm run dev

# Run tests
pytest -v

# Lint (if configured)
ruff check backend/
```

---

## License

MIT

---

## Built With

- [FastAPI](https://fastapi.tiangolo.com)
- [React](https://react.dev)
- [APScheduler](https://apscheduler.readthedocs.io)
- [OpenRouter](https://openrouter.ai)
- [Cerebras](https://cerebras.ai)
- [Groq](https://groq.com)
