#!/usr/bin/env python3
import json, os, asyncio, time, uuid, subprocess
from datetime import datetime
from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Query, UploadFile, File, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
import uvicorn

from engine import ENGINES, get_active_engines, call_engine, get_engine_status, mark_engine, get_api_key, suggest_engine_for, record_engine_perf
from tools import TOOL_DEFINITIONS, execute_tool, read_activity
from agents import AGENTS, get_agent, get_agents
from memory_summary import get_context_for_agent, needs_summary, store_fact, recall_fact, get_all_facts, summarize_conversation
from collaboration import bus

AION_DIR = os.path.expanduser("~/AION")
MAX_TOOL_ITER = 5

sessions = {}
active_connections = set()

@asynccontextmanager
async def lifespan(app):
    print("AIONCLAW server starting...")
    # Initialize default projects
    pdata = _load_project()
    default_projects = ["angelus_pastry", "angeliki_savvidaki", "melisanuts", "mike_artistic_team"]
    for p in default_projects:
        if p not in pdata["projects"]:
            pdata["projects"].append(p)
    _save_project(pdata)
    print(f"Projects: {pdata['projects']}")
    yield
    print("AIONCLAW server stopped.")

app = FastAPI(title="AIONCLAW", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

AIONCLAW_API_KEY = os.environ.get("AIONCLAW_API_KEY", "")

@app.middleware("http")
async def auth_middleware(request: Request, call_next):
    if AIONCLAW_API_KEY:
        if request.url.path.startswith("/api/"):
            client_key = request.headers.get("x-api-key", "")
            if client_key != AIONCLAW_API_KEY:
                return JSONResponse(status_code=401, content={"detail": "Unauthorized"})
    return await call_next(request)

SYSTEM_PROMPT = """Είσαι ο AION CEO Agent, το κεντρικό AI σύστημα της AION Web Solutions.
Απαντάς στα Ελληνικά (με αγγλικούς τεχνικούς όρους όπου χρειάζεται).
Είσαι ένα expert AI agent που μπορείς να χρησιμοποιείς εργαλεία για να:
- Διαβάζεις και γράφεις αρχεία
- Εκτελείς commands
- Ψάχνεις στο web
- Αποθηκεύεις πληροφορίες στη μνήμη

Πάντα να χρησιμοποιείς τα εργαλεία όταν χρειάζεται, αντί να λες ότι δεν μπορείς να κάνεις κάτι."""

class ChatRequest(BaseModel):
    message: str
    session_id: str = "default"
    system_prompt: str = ""
    tools_enabled: bool = True
    engine_id: str = ""
    agent_id: str = "ceo"
    stream: bool = False
    model_params: dict = {}

class ChatResponse(BaseModel):
    response: str
    engine_used: str
    tool_calls: list = []
    finish_reason: str = ""

class AgentContext:
    def __init__(self, system_prompt, tools_enabled, agent_id="ceo", session_id="default"):
        self.agent_id = agent_id
        self.session_id = session_id
        self.tools_enabled = tools_enabled
        self.message_count = 0
        self.last_summary_len = 0

        agent = get_agent(agent_id)
        base_prompt = system_prompt or agent["system_prompt"]

        memory_context = get_context_for_agent(agent_id)
        if memory_context:
            base_prompt += f"\n\nΣΗΜΕΙΩΣΕΙΣ ΑΠΟ ΜΝΗΜΗ:\n{memory_context}"

        if agent_id == "ceo":
            from agents import get_agents
            ceo_view = get_agents()
            agent_list_parts = [f"\n\nΟΙ AGENTS ΣΟΥ (Η ΟΜΑΔΑ ΣΟΥ):"]
            for a in ceo_view:
                agent_list_parts.append(f"  {a['icon']} {a['name']} ({a['id']}) — {a['role']}")
            base_prompt += "\n".join(agent_list_parts)

        # Inject uploaded file names for this agent
        uploaded = get_agent_file_names(agent_id)
        if uploaded:
            from agents import AGENTS
            base_prompt += f"\n\nΑΝΕΒΑΣΜΕΝΑ ΑΡΧΕΙΑ (για {agent_id}):\n"
            for fname in uploaded:
                fpath = None
                # Search all agent upload dirs to find actual file
                for a in AGENTS + [{"id": "ceo"}]:
                    candidate = os.path.join(UPLOAD_DIR, a["id"], fname)
                    if os.path.exists(candidate):
                        fpath = candidate
                        break
                if fpath:
                    fsize = os.path.getsize(fpath)
                    base_prompt += f"  - {fname} ({fsize} bytes) — διάβασέ το με read_file('{fpath}')\n"
                else:
                    base_prompt += f"  - {fname}\n"

        self.system_prompt = base_prompt
        self.messages = [{"role": "system", "content": self.system_prompt}]

        # Load previous messages from session file so agent remembers history
        session_file = _session_file(session_id)
        try:
            if os.path.exists(session_file):
                with open(session_file) as f:
                    data = json.load(f)
                for msg in data.get("messages", []):
                    role = msg.get("role", "")
                    content = msg.get("content", "")
                    if role == "user":
                        self.messages.append({"role": "user", "content": content or ""})
                        self.message_count += 1
                    elif role == "assistant":
                        self.messages.append({"role": "assistant", "content": content or ""})
                    elif role == "system" and content:
                        self.messages.append({"role": "system", "content": content})
        except Exception:
            pass

    def add_message(self, role, content, tool_calls=None, tool_call_id=None):
        msg = {"role": role, "content": content, "ts": datetime.now().isoformat()}
        if tool_calls:
            msg["tool_calls"] = tool_calls
        if tool_call_id:
            msg["tool_call_id"] = tool_call_id
        self.messages.append(msg)
        if role == "user":
            self.message_count += 1

MAX_CONTEXT_MSGS = 12

def trim_messages(messages):
    """Keep system prompt + last N messages for context efficiency."""
    system = [m for m in messages if m.get("role") == "system"]
    non_system = [m for m in messages if m.get("role") != "system"]
    trimmed = non_system[-MAX_CONTEXT_MSGS:]
    return system + trimmed

def run_agent(ctx, engine_override=""):
    if engine_override:
        engine = next((e for e in ENGINES if e["id"] == engine_override), None)
        if not engine:
            return {"response": f"Engine '{engine_override}' not found", "engine_used": "none", "tool_calls": []}
        engines_to_try = [engine]
    else:
        suggested = suggest_engine_for("general", needs_tools=ctx.tools_enabled)
        engines_to_try = get_active_engines()
        if suggested and suggested in engines_to_try:
            engines_to_try = [suggested] + [e for e in engines_to_try if e["id"] != suggested["id"]]

    if not engines_to_try:
        return {"response": "Δεν υπάρχει διαθέσιμο engine. Έλεγξε API keys και engine status.", "engine_used": "none", "tool_calls": []}

    last_error = ""
    for engine in engines_to_try:
        for attempt in range(2):
            try:
                t0 = time.time()
                msgs = trim_messages(ctx.messages)
                resp = call_engine(engine, msgs, tools=TOOL_DEFINITIONS if ctx.tools_enabled else None, stream=False)
                t1 = time.time()
                data = resp.json()
                choice = data["choices"][0]
                msg = choice["message"]

                engine_id = engine["id"]
                record_engine_perf(engine_id, t1 - t0, True)

                if msg.get("tool_calls"):
                    ctx.add_message("assistant", msg.get("content") or "", tool_calls=msg["tool_calls"])
                    tool_results = []
                    for tc in msg["tool_calls"][:MAX_TOOL_ITER]:
                        if isinstance(tc, dict):
                            func_name = tc.get("function", {}).get("name", "")
                            func_args = json.loads(tc.get("function", {}).get("arguments", "{}"))
                            tc_id = tc.get("id", "")
                        else:
                            func_name = tc.function.name
                            func_args = json.loads(tc.function.arguments)
                            tc_id = tc.id
                        result = execute_tool(func_name, func_args, ctx.agent_id)
                        ctx.add_message("tool", result, tool_call_id=tc_id)
                        tool_results.append({"name": func_name, "result": result[:200]})

                    final_resp = call_engine(engine, trim_messages(ctx.messages), stream=False)
                    t3 = time.time()
                    record_engine_perf(engine_id, t3 - t2, True)
                    final_data = final_resp.json()
                    final_text = final_data["choices"][0]["message"].get("content", "")
                    ctx.add_message("assistant", final_text)
                    return {"response": final_text, "engine_used": engine_id, "tool_calls": tool_results}
                else:
                    text = msg.get("content", "")
                    ctx.add_message("assistant", text)
                    return {"response": text, "engine_used": engine_id, "tool_calls": []}

            except Exception as e:
                last_error = str(e)
                record_engine_perf(engine["id"], 0, False)
                if "rate limit" in last_error.lower() or "too large" in last_error.lower():
                    mark_engine(engine["id"], "rate_limited", 60)
                    break
                continue

    return {"response": f"Σφάλμα σε όλα τα engines: {last_error}", "engine_used": "none", "tool_calls": []}

@app.get("/api/agents")
async def list_agents():
    return {"agents": get_agents()}

@app.get("/api/health")
async def health():
    return {"status": "ok", "version": "1.0.0", "time": datetime.now().isoformat()}

@app.get("/api/engines")
async def engines():
    return {"engines": get_engine_status()}

@app.post("/api/chat")
async def chat(req: ChatRequest):
    ctx = sessions.get(req.session_id)
    if not ctx:
        ctx = AgentContext(req.system_prompt, req.tools_enabled, agent_id=req.agent_id, session_id=req.session_id)
        sessions[req.session_id] = ctx
    ctx.add_message("user", req.message)
    result = run_agent(ctx, req.engine_id)

    if needs_summary(ctx.messages):
        active = get_active_engines()
        if active:
            try:
                await summarize_conversation(call_engine, active[0], trim_messages(ctx.messages), ctx.agent_id)
            except:
                pass

    return ChatResponse(
        response=result["response"],
        engine_used=result["engine_used"],
        tool_calls=result.get("tool_calls", []),
        finish_reason="stop"
    )

@app.get("/api/sessions")
async def list_sessions():
    return {"sessions": list(sessions.keys()), "count": len(sessions)}

@app.delete("/api/sessions/{session_id}")
async def clear_session(session_id: str):
    if session_id in sessions:
        del sessions[session_id]
        return {"status": "cleared"}
    return {"status": "not_found"}

@app.get("/api/keys")
async def list_keys():
    env_path = os.path.join(AION_DIR, ".env")
    keys = {}
    try:
        if os.path.exists(env_path):
            with open(env_path) as f:
                for line in f:
                    line = line.strip()
                    if line.startswith("export ") and "_API_KEY=" in line:
                        kv = line[7:].split("=", 1)
                        if len(kv) == 2:
                            eid = kv[0].replace("_API_KEY", "").lower()
                            val = kv[1].strip("\"'")
                            keys[eid] = val[:8] + "..." + val[-4:] if len(val) > 12 else val
    except:
        pass
    for e in ENGINES:
        eid = e["id"]
        if eid not in keys:
            env_key = os.environ.get(f"{eid.upper()}_API_KEY", "")
            if env_key:
                keys[eid] = env_key[:8] + "..." + env_key[-4:] if len(env_key) > 12 else env_key
    return {"keys": keys}

@app.post("/api/keys")
async def update_key(data: dict):
    engine_id = data.get("engine_id")
    api_key = data.get("api_key")
    if not engine_id or not api_key:
        raise HTTPException(400, "engine_id and api_key required")
    os.environ[f"{engine_id.upper()}_API_KEY"] = api_key
    env_path = os.path.join(AION_DIR, ".env")
    try:
        existing = ""
        if os.path.exists(env_path):
            with open(env_path) as f:
                existing = f.read()
        key_line = f"export {engine_id.upper()}_API_KEY={api_key}\n"
        if f"export {engine_id.upper()}_API_KEY=" in existing:
            lines = [l if not l.startswith(f"export {engine_id.upper()}_API_KEY=") else key_line.strip() for l in existing.split("\n")]
            existing = "\n".join(lines)
        else:
            existing += "\n" + key_line
        with open(env_path, "w") as f:
            f.write(existing)
    except:
        pass
    return {"status": "updated"}

@app.get("/api/leads")
async def get_leads():
    leads_file = os.path.join(AION_DIR, "AION_CONNECT_CRM", "leads", "leads-database.json")
    try:
        with open(leads_file) as f:
            data = json.load(f)
            if isinstance(data, list):
                return {"leads": data, "count": len(data)}
            return data
    except:
        return {"leads": [], "count": 0, "error": "leads database not found"}

UPLOAD_DIR = os.path.join(AION_DIR, "aionclaw", "uploads")

@app.post("/api/agents/{agent_id}/upload")
async def upload_agent_file(agent_id: str, file: UploadFile = File(...)):
    dir_path = os.path.join(UPLOAD_DIR, agent_id)
    os.makedirs(dir_path, exist_ok=True)
    content = await file.read()
    file_path = os.path.join(dir_path, file.filename)
    with open(file_path, "wb") as f:
        f.write(content)
    print(f"Uploaded: {file_path} ({len(content)} bytes)")
    return {"status": "uploaded", "filename": file.filename, "path": file_path, "size": len(content)}

@app.get("/api/agents/{agent_id}/files")
async def list_agent_files(agent_id: str):
    files = []
    # Agent's own files
    dir_path = os.path.join(UPLOAD_DIR, agent_id)
    if os.path.exists(dir_path):
        for name in sorted(os.listdir(dir_path)):
            full = os.path.join(dir_path, name)
            try:
                files.append({
                    "name": name,
                    "size": os.path.getsize(full),
                    "modified": datetime.fromtimestamp(os.path.getmtime(full)).isoformat(),
                    "source": agent_id,
                })
            except:
                pass
    # CEO's files (shared with all)
    if agent_id != "ceo":
        ceo_path = os.path.join(UPLOAD_DIR, "ceo")
        if os.path.exists(ceo_path):
            for name in sorted(os.listdir(ceo_path)):
                full = os.path.join(ceo_path, name)
                if not any(f["name"] == name for f in files):
                    try:
                        files.append({
                            "name": name,
                            "size": os.path.getsize(full),
                            "modified": datetime.fromtimestamp(os.path.getmtime(full)).isoformat(),
                            "source": "ceo (shared)",
                        })
                    except:
                        pass
    return {"files": files, "agent_id": agent_id}

@app.delete("/api/agents/{agent_id}/files/{filename}")
async def delete_agent_file(agent_id: str, filename: str):
    file_path = os.path.join(UPLOAD_DIR, agent_id, filename)
    if os.path.exists(file_path):
        os.remove(file_path)
        return {"status": "deleted", "filename": filename}
    raise HTTPException(404, "File not found")

def get_agent_file_names(agent_id):
    """Get list of uploaded filenames for an agent (including CEO's shared files)."""
    from agents import AGENTS
    files = set()
    # Agent's own files
    dir_path = os.path.join(UPLOAD_DIR, agent_id)
    if os.path.exists(dir_path):
        files.update(os.listdir(dir_path))
    # CEO sees ALL agents' files
    if agent_id == "ceo":
        for a in AGENTS:
            d = os.path.join(UPLOAD_DIR, a["id"])
            if os.path.exists(d):
                files.update(os.listdir(d))
    # Other agents see CEO's shared files too
    if agent_id != "ceo":
        ceo_path = os.path.join(UPLOAD_DIR, "ceo")
        if os.path.exists(ceo_path):
            files.update(os.listdir(ceo_path))
    return sorted(files)

@app.get("/api/collab/history")
async def collab_history():
    path = os.path.join(AION_DIR, "MEMORY", "collab_log.json")
    try:
        if os.path.exists(path):
            with open(path) as f:
                events = json.load(f)
            return {"events": events[-100:]}
    except:
        pass
    return {"events": []}

@app.post("/api/collab/clear")
async def collab_clear():
    path = os.path.join(AION_DIR, "MEMORY", "collab_log.json")
    try:
        from collaboration import bus
        bus.history = []
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w") as f:
            json.dump([], f)
        return {"ok": True}
    except Exception as e:
        return {"ok": False, "error": str(e)}

@app.get("/api/collab/reads")
async def collab_reads():
    from reads import get_reads
    return {"reads": get_reads()}

@app.post("/api/collab/events/{event_id}/read")
async def collab_event_read(event_id: str):
    from reads import mark_read
    mark_read(event_id)
    return {"ok": True}

@app.post("/api/collab/events/{event_id}/unread")
async def collab_event_unread(event_id: str):
    from reads import mark_unread
    mark_unread(event_id)
    return {"ok": True}

PROJECT_FILE = os.path.join(AION_DIR, "MEMORY", "project.json")

def _load_project():
    try:
        if os.path.exists(PROJECT_FILE):
            with open(PROJECT_FILE) as f:
                return json.load(f)
    except: pass
    return {"current": "default", "projects": ["default"]}

def _save_project(data):
    os.makedirs(os.path.dirname(PROJECT_FILE), exist_ok=True)
    with open(PROJECT_FILE, "w") as f:
        json.dump(data, f, indent=2)

@app.get("/api/project")
async def get_project():
    return _load_project()

@app.post("/api/project")
async def set_project(data: dict):
    name = data.get("name", "default").strip()
    if not name: name = "default"
    safe = name.lower().replace(" ", "_").replace("/", "_")
    pdata = _load_project()
    pdata["current"] = safe
    if safe not in pdata["projects"]:
        pdata["projects"].append(safe)
    _save_project(pdata)

    # Auto-migrate existing root-level sessions to this project
    if safe != "default":
        pdir = os.path.join(SESSION_DIR, safe)
        os.makedirs(pdir, exist_ok=True)
        import shutil
        for fname in os.listdir(SESSION_DIR):
            if fname.endswith(".json") and os.path.isfile(os.path.join(SESSION_DIR, fname)):
                src = os.path.join(SESSION_DIR, fname)
                dst = os.path.join(pdir, fname)
                if not os.path.exists(dst):
                    shutil.copy2(src, dst)
    # Also migrate to default/ dir for consistency
    defdir = os.path.join(SESSION_DIR, "default")
    os.makedirs(defdir, exist_ok=True)
    for fname in os.listdir(SESSION_DIR):
        if fname.endswith(".json") and os.path.isfile(os.path.join(SESSION_DIR, fname)):
            src = os.path.join(SESSION_DIR, fname)
            dst = os.path.join(defdir, fname)
            if not os.path.exists(dst):
                import shutil
                shutil.copy2(src, dst)
        elif os.path.isdir(os.path.join(SESSION_DIR, fname)) and fname != "default" and fname != safe:
            # Also copy sessions from other projects into default
            pdir = os.path.join(SESSION_DIR, fname)
            for sf in os.listdir(pdir):
                if sf.endswith(".json"):
                    src = os.path.join(pdir, sf)
                    dst = os.path.join(defdir, sf)
                    if not os.path.exists(dst):
                        shutil.copy2(src, dst)

    return pdata

@app.get("/api/projects")
async def list_projects():
    return _load_project()

@app.delete("/api/project/{name}")
async def delete_project(name: str):
    safe = name.lower().replace(" ", "_").replace("/", "_")
    if safe == "default":
        return {"ok": False, "error": "Cannot delete default project"}
    pdata = _load_project()
    if safe in pdata["projects"]:
        pdata["projects"].remove(safe)
        if pdata.get("current") == safe:
            pdata["current"] = "default"
        _save_project(pdata)
    # Remove project session directory (memory is safe in central memory.json)
    pdir = os.path.join(SESSION_DIR, safe)
    if os.path.exists(pdir):
        import shutil
        shutil.rmtree(pdir)
    return {"ok": True}

@app.get("/api/approvals/pending")
async def approvals_pending():
    from approval import get_pending
    return {"approvals": get_pending()}

class ApprovalAction(BaseModel):
    request_id: str

@app.post("/api/approvals/{request_id}/approve")
async def approvals_approve(request_id: str):
    from approval import approve as approve_req
    from collaboration import bus, run_sub_agent, save_to_agent_session
    req = approve_req(request_id, "user")
    if not req:
        return {"ok": False, "error": "Not found or already processed"}
    bus.broadcast({
        "type": "approval_result",
        "request_id": request_id,
        "status": "approved",
        "ts": datetime.now().isoformat(),
    })
    agent_id = req.get("agent_id", "dev")
    full_result = run_sub_agent(agent_id,
        f"✅ Το αίτημα έγκρισης #{request_id} ΕΓΚΡΙΘΗΚΕ από τον χρήστη. "
        f"Θέμα: {req['summary']}\n\n"
        f"Συνέχισε ΤΩΡΑ με την πλήρη ανάλυση όπως είχες προγραμματίσει. "
        f"Γράψε λεπτομερώς και εκτενώς.")
    save_to_agent_session(agent_id, "default",
        f"✅ Έγκριση #{request_id} για: {req['summary']}", full_result)
    bus.broadcast({
        "type": "agent_chat",
        "agent_id": agent_id,
        "session_id": "default",
        "exchange": [
            {"role": "user", "content": f"✅ Έγκριση #{request_id} — {req['summary']}", "_aid": agent_id, "_sid": "default"},
            {"role": "assistant", "content": full_result[:3000], "_aid": agent_id, "_sid": "default"},
        ]
    })
    return {"ok": True, "result": full_result[:2000]}

@app.post("/api/approvals/{request_id}/reject")
async def approvals_reject(request_id: str):
    from approval import reject as reject_req
    from collaboration import bus
    req = reject_req(request_id)
    if not req:
        return {"ok": False, "error": "Not found or already processed"}
    bus.broadcast({
        "type": "approval_result",
        "request_id": request_id,
        "status": "rejected",
        "ts": datetime.now().isoformat(),
    })
    return {"ok": True}

SESSION_DIR = os.path.join(AION_DIR, "aionclaw", "sessions")
SESSION_CACHE = {}  # full_key -> {"messages": list, "ts": float}
SESSION_CACHE_TTL = 1800  # 30 minutes

def _cache_get(full_key):
    entry = SESSION_CACHE.get(full_key)
    if entry and time.time() - entry["ts"] < SESSION_CACHE_TTL:
        return entry["data"]
    SESSION_CACHE.pop(full_key, None)
    return None

def _cache_set(full_key, data):
    SESSION_CACHE[full_key] = {"data": data, "ts": time.time()}

def _cache_invalidate(full_key):
    SESSION_CACHE.pop(full_key, None)

def _session_file(full_key):
    safe = full_key.replace(":", "_").replace("/", "_")
    pdata = _load_project()
    project = pdata.get("current", "default")
    pdir = os.path.join(SESSION_DIR, project)
    os.makedirs(pdir, exist_ok=True)
    fpath = os.path.join(pdir, f"{safe}.json")
    # Fallback: if file doesn't exist in project dir, check root level
    if not os.path.exists(fpath):
        legacy = os.path.join(SESSION_DIR, f"{safe}.json")
        if os.path.exists(legacy):
            return legacy
    return fpath

@app.post("/api/sessions/{full_key}/save")
async def save_session_messages(full_key: str, data: dict):
    path = _session_file(full_key)
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        existing = []
        if os.path.exists(path):
            with open(path) as f:
                try:
                    existing = json.load(f).get("messages", [])
                except:
                    existing = []
        incoming = data.get("messages", [])
        existing_ids = set()
        for m in existing:
            key = f"{m.get('role','')}|{m.get('content','')[:200]}|{m.get('ts','')}"
            existing_ids.add(key)
        merged = list(existing)
        for m in incoming:
            key = f"{m.get('role','')}|{m.get('content','')[:200]}|{m.get('ts','')}"
            if key not in existing_ids:
                merged.append(m)
                existing_ids.add(key)
        payload = {"messages": merged}
        with open(path, "w") as f:
            json.dump(payload, f, indent=2, ensure_ascii=False)
        _cache_set(full_key, payload)
        return {"status": "saved", "count": len(merged)}
    except Exception as e:
        raise HTTPException(400, f"Save error: {e}")

@app.get("/api/sessions/{full_key}/load")
async def load_session_messages(full_key: str):
    cached = _cache_get(full_key)
    if cached:
        return cached
    path = _session_file(full_key)
    try:
        if os.path.exists(path):
            with open(path) as f:
                data = json.load(f)
                _cache_set(full_key, data)
                # Return full history for UI display
                return data
        return {"messages": []}
    except Exception as e:
        return {"messages": [], "error": str(e)}

@app.get("/api/performance")
async def get_performance():
    from performance import get_report
    return get_report()

@app.get("/api/engine-perf")
async def get_engine_performance():
    from engine import get_engine_perf, get_engine_status
    return {"stats": get_engine_perf(), "engines": get_engine_status()}

@app.get("/api/activity")
async def get_activity(limit: int = Query(100)):
    return {"entries": read_activity(limit)}

@app.get("/api/files")
async def list_files(path: str = ""):
    base = os.path.expanduser(path) if path else AION_DIR
    if not os.path.isdir(base):
        raise HTTPException(400, f"Not a directory: {base}")
    items = []
    for name in sorted(os.listdir(base)):
        full = os.path.join(base, name)
        try:
            stat = os.stat(full)
            items.append({
                "name": name,
                "path": full,
                "is_dir": os.path.isdir(full),
                "size": stat.st_size,
                "modified": datetime.fromtimestamp(stat.st_mtime).isoformat(),
            })
        except:
            pass
    return {"path": base, "items": items, "parent": os.path.dirname(base) if base != "/" else None}

@app.get("/api/files/read")
async def read_file(path: str):
    full = os.path.expanduser(path)
    if not os.path.isfile(full):
        raise HTTPException(400, f"File not found: {full}")
    if os.path.getsize(full) > 1024 * 1024:
        raise HTTPException(400, "File too large (>1MB)")
    try:
        with open(full) as f:
            content = f.read()
        return {"path": full, "content": content, "size": len(content)}
    except Exception as e:
        raise HTTPException(400, f"Read error: {e}")

@app.websocket("/ws/chat")
async def websocket_chat(ws: WebSocket):
    await ws.accept()
    client_id = str(uuid.uuid4())[:8]
    active_connections.add(ws)
    print(f"WS client connected: {client_id}")

    try:
        data = await ws.receive_json()
        session_id = data.get("session_id", "default")
        system_prompt = data.get("system_prompt", "")
        tools_enabled = data.get("tools_enabled", True)
        engine_override = data.get("engine_id", "")
        agent_id = data.get("agent_id", "ceo")

        def ws_send(msg):
            msg["_aid"] = agent_id
            msg["_sid"] = session_id.split(":", 1)[-1] if ":" in session_id else session_id
            return ws.send_json(msg)

        ctx = sessions.get(session_id)
        if not ctx:
            ctx = AgentContext(system_prompt, tools_enabled, agent_id=agent_id, session_id=session_id)
            sessions[session_id] = ctx

        ctx.add_message("user", data.get("message", ""))
        bus.status(agent_id, True, "writing")
        ws_start_time = time.time()

        # Broadcast agent thinking on chat start
        bus.broadcast({
            "type": "agent_thinking",
            "agent_id": agent_id,
            "status": "started",
            "thought": f"🤔 {agent_id}: επεξεργάζεται το μήνυμά σας...",
            "ts": datetime.now().isoformat(),
        })

        if engine_override:
            engines_to_try = [e for e in ENGINES if e["id"] == engine_override] or []
            if not engines_to_try:
                engines_to_try = get_active_engines()
        else:
            suggested = suggest_engine_for("general", needs_tools=tools_enabled)
            engines_to_try = get_active_engines()
            if suggested and suggested in engines_to_try:
                engines_to_try = [suggested] + [e for e in engines_to_try if e["id"] != suggested["id"]]

        last_error = ""
        response_text = ""
        tool_calls_made = []
        engine_used = "none"

        for engine in engines_to_try:
            try:
                t0 = time.time()
                engine_used = engine["id"]
                await ws_send({"type": "status", "engine": engine["id"], "status": "calling"})

                resp = call_engine(engine, trim_messages(ctx.messages), tools=TOOL_DEFINITIONS if tools_enabled else None, stream=True)

                full_content = ""
                collected_tools = []
                finish = ""
                response_start = datetime.now().isoformat()

                for line in resp.iter_lines():
                    if not line:
                        continue
                    if line.startswith(b"data: "):
                        chunk_str = line[6:].decode()
                        if chunk_str == "[DONE]":
                            break
                        try:
                            chunk = json.loads(chunk_str)
                            delta = chunk.get("choices", [{}])[0].get("delta", {})
                            if delta.get("content"):
                                full_content += delta["content"]
                                await ws_send({"type": "delta", "content": delta["content"], "ts": response_start})
                            if delta.get("tool_calls"):
                                for tc in delta["tool_calls"]:
                                    collected_tools.append(tc)
                            finish = chunk.get("choices", [{}])[0].get("finish_reason", "")
                        except:
                            continue
                t1 = time.time()
                record_engine_perf(engine["id"], t1 - t0, True)

                if collected_tools:
                    combined_tools = []
                    tc_map = {}
                    tc_order = []
                    for tc in collected_tools:
                        idx = tc.get("index", 0)
                        if idx not in tc_map:
                            tc_map[idx] = {"id": tc.get("id", ""), "function": {"name": "", "arguments": ""}}
                            tc_order.append(idx)
                        if tc.get("id"):
                            tc_map[idx]["id"] = tc["id"]
                        func = tc.get("function", {})
                        if func.get("name"):
                            tc_map[idx]["function"]["name"] += func["name"]
                        if func.get("arguments"):
                            tc_map[idx]["function"]["arguments"] += func["arguments"]
                    combined_tools = [tc_map[i] for i in tc_order]

                    ctx.add_message("assistant", full_content, tool_calls=combined_tools)
                    await ws_send({"type": "tool_calls", "tool_calls": combined_tools})

                    total_tools = len(combined_tools)
                    for ti, tc in enumerate(combined_tools):
                        func_name = tc.get("function", {}).get("name", "")
                        func_args = json.loads(tc.get("function", {}).get("arguments", "{}")) if tc.get("function", {}).get("arguments") else {}
                        tc_id = tc.get("id", "")
                        await ws_send({"type": "tool_start", "name": func_name, "args": func_args})
                        # Broadcast progress + thinking via collab bus
                        progress_pct = min(int((ti + 1) / total_tools * 95), 95)
                        bus.broadcast({
                            "type": "task_progress",
                            "agent_id": agent_id,
                            "status": "running",
                            "progress": progress_pct,
                            "message": f"🔧 {func_name} ({ti+1}/{total_tools})",
                            "ts": datetime.now().isoformat(),
                        })
                        bus.broadcast({
                            "type": "agent_thinking",
                            "agent_id": agent_id,
                            "status": "thinking",
                            "thought": f"💭 {agent_id}: εκτελεί {func_name} ({ti+1}/{total_tools})",
                            "ts": datetime.now().isoformat(),
                        })
                        result = await asyncio.to_thread(execute_tool, func_name, func_args, ctx.agent_id)
                        await ws_send({"type": "tool_result", "name": func_name, "result": result[:500]})
                        ctx.add_message("tool", result, tool_call_id=tc_id)
                        tool_calls_made.append({"name": func_name, "result": result[:200]})

                    # Broadcast synthesizing
                    bus.broadcast({
                        "type": "agent_thinking",
                        "agent_id": agent_id,
                        "status": "synthesizing",
                        "thought": f"🧠 {agent_id}: συνθέτει αποτελέσματα εργαλείων...",
                        "ts": datetime.now().isoformat(),
                    })
                    t2 = time.time()
                    final_resp = call_engine(engine, trim_messages(ctx.messages), stream=True, max_tokens=1024)
                    final_content = ""
                    for line in final_resp.iter_lines():
                        if not line:
                            continue
                        if line.startswith(b"data: "):
                            chunk_str = line[6:].decode()
                            if chunk_str == "[DONE]":
                                break
                            try:
                                chunk = json.loads(chunk_str)
                                d = chunk.get("choices", [{}])[0].get("delta", {})
                                if d.get("content"):
                                    final_content += d["content"]
                                    await ws_send({"type": "delta", "content": d["content"]})
                            except:
                                continue
                    record_engine_perf(engine["id"], time.time() - t2, True)
                    response_text = final_content
                    ctx.add_message("assistant", final_content)
                else:
                    response_text = full_content
                    ctx.add_message("assistant", full_content)

                if needs_summary(ctx.messages):
                    try:
                        await summarize_conversation(call_engine, engine, trim_messages(ctx.messages), ctx.agent_id)
                    except:
                        pass
                bus.status(agent_id, False, "has_response")
                bus.broadcast({
                    "type": "agent_thinking",
                    "agent_id": agent_id,
                    "status": "complete",
                    "thought": f"✅ {agent_id} ολοκλήρωσε την απάντηση",
                    "ts": datetime.now().isoformat(),
                })
                # Complete progress
                if tool_calls_made:
                    bus.broadcast({
                        "type": "task_progress",
                        "agent_id": agent_id,
                        "status": "complete",
                        "progress": 100,
                        "message": f"✅ {agent_id} completed",
                        "ts": datetime.now().isoformat(),
                    })
                bus.broadcast({
                    "type": "agent_chat",
                    "agent_id": agent_id,
                    "session_id": session_id.split(":", 1)[-1] if ":" in session_id else session_id,
                    "exchange": [
                        {"role": "user", "content": data.get("message", ""), "_aid": agent_id, "_sid": session_id.split(":", 1)[-1] if ":" in session_id else session_id},
                        {"role": "assistant", "content": (response_text or full_content or "")[:3000], "_aid": agent_id, "_sid": session_id.split(":", 1)[-1] if ":" in session_id else session_id},
                    ]
                })
                await ws_send({"type": "done", "engine": engine_used, "tool_calls": tool_calls_made})
                # Log performance
                try:
                    from performance import log_performance
                    perf_duration = time.time() - ws_start_time
                    log_performance(agent_id, data.get("message",""), perf_duration, engine_used, True, tool_calls=len(tool_calls_made))
                except: pass
                break

            except Exception as e:
                last_error = str(e)
                record_engine_perf(engine["id"], 0, False)
                error_lower = str(e).lower()
                if "rate limit" in error_lower or "too large" in error_lower:
                    mark_engine(engine["id"], "rate_limited", 60)
                elif "quota" in error_lower or "billing" in error_lower:
                    mark_engine(engine["id"], "quota_exhausted", 3600)
                elif "timeout" in error_lower or "connection" in error_lower:
                    mark_engine(engine["id"], "timeout", 120)
                continue
        else:
            bus.status(agent_id, False, "failure")
            bus.broadcast({
                "type": "agent_thinking",
                "agent_id": agent_id,
                "status": "error",
                "thought": f"❌ {agent_id} απέτυχε: {last_error[:100]}",
                "ts": datetime.now().isoformat(),
            })
            await ws_send({"type": "error", "message": f"Σφάλμα σε όλα τα engines: {last_error}"})

    except WebSocketDisconnect:
        pass
    except Exception as e:
        try:
            await ws_send({"type": "error", "message": str(e)[:500]})
        except:
            pass
    finally:
        active_connections.discard(ws)
        print(f"WS client disconnected: {client_id}")

@app.websocket("/ws/collab")
async def websocket_collab(ws: WebSocket):
    await ws.accept()
    bus.connections.add(ws)
    print("Collab WS connected")
    try:
        while True:
            data = await ws.receive_text()
            msg = json.loads(data)
            if msg.get("type") == "ping":
                await ws.send_json({"type": "pong"})
    except:
        pass
    finally:
        bus.connections.discard(ws)
        print("Collab WS disconnected")

if __name__ == "__main__":
    import socket
    port = int(os.environ.get("PORT", 9789))
    print(f"AIONCLAW backend starting on http://127.0.0.1:{port}")
    uvicorn.run(app, host="127.0.0.1", port=port)
