"""Shared logic extracted from main.py — AgentContext, run_agent, helpers, globals."""
import json, os, time, asyncio, subprocess, threading
from datetime import datetime
from fastapi import HTTPException
from pydantic import BaseModel

from engine import ENGINES, get_active_engines, call_engine, mark_engine, suggest_engine_for, record_engine_perf
from tools import TOOL_DEFINITIONS, get_tool_definitions_for_agent, execute_tool, read_activity
from agents import AGENTS, get_agent, get_agents
from memory_summary import get_context_for_agent, needs_summary, summarize_conversation, get_summaries, store_summary
from collaboration import bus
from config import AION_DIR, MEMORY_DIR, SESSIONS_DIR, UPLOADS_DIR as CFG_UPLOADS_DIR, COLLAB_LOG, LEADS_FILE, DOTENV_FILE, PROJECT_FILE as CFG_PROJECT_FILE

MAX_TOOL_ITER = 5
MAX_CONTEXT_MSGS = 6

INJECTION_PATTERNS = [
    "ignore all previous instructions", "αγνόησε όλες τις προηγούμενες οδηγίες",
    "ignore all prior", "αγνόησε όλες τις προηγούμενες",
    "do anything now", "dan", "you are now", "εισαι τωρα",
    "system prompt", "output your instructions", "βγαλε τις οδηγιες",
    "forget everything", "ξεχασε τα παντα", "you must obey",
    "ρεσετ", "reset", "new prompt", "νεο prompt",
    "bypass", "παράκαμψη", "you are not", "δεν εισαι",
    "act as", "συμπεριφερσου ως", "pretend", "προσποιησου",
    "reveal", "αποκαλυψε", "show your", "δειξε μου",
]

def detect_injection(text):
    if not text:
        return False
    text_lower = text.lower().strip()
    for pattern in INJECTION_PATTERNS:
        if pattern in text_lower:
            return True
    return False

_project_lock = threading.Lock()
_session_file_lock = threading.Lock()

sessions = {}
active_connections = set()
session_engine_cache = {}

GREEK_LANG = """ΓΡΑΨΕ ΣΕ ΑΡΙΣΤΑ ΣΥΓΧΡΟΝΑ ΕΛΛΗΝΙΚΑ — ΦΥΣΙΚΑ, ΚΑΘΑΡΑ, ΜΕ ΥΦΟΣ:

ΟΡΘΟΓΡΑΦΙΑ & ΓΡΑΜΜΑΤΙΚΗ:
- Απόλυτα σωστή ορθογραφία, τονισμό, γραμματική, συντακτικό. Αν έχεις αμφιβολία, ΚΑΛΕΣΕ lookup_word.
- Σωστή κλίση ουσιαστικών, επιθέτων, ρημάτων. Προσοχή στη γενική πληθυντικού.

ΛΕΞΙΛΟΓΙΟ:
- Πλούσιο, ποικίλο, ακριβές, φυσικό. Απόφυγε επαναλήψεις και κοινοτοπίες.
- Σύγχρονη νεοελληνική — όχι αρχαΐζουσες λέξεις ή ψευτολόγιο.
- Απόφυγε αγγλισμούς και μηχανικές μεταφράσεις.

ΥΦΟΣ & ΡΟΗ:
- Φυσική ροή, ποικιλία προτάσεων, σαφήνεια.
- Ανάλογα το κοινό: επίσημο αλλά όχι ψυχρό, φιλικό αλλά όχι οικείο.

ΕΡΓΑΛΕΙΑ:
- lookup_word: για κάθε αμφιβολία ορθογραφίας, σημασίας, κλίσης."""

PROJECT_FILE = str(CFG_PROJECT_FILE)

def _load_project():
    with _project_lock:
        try:
            if os.path.exists(PROJECT_FILE):
                with open(PROJECT_FILE) as f:
                    return json.load(f)
        except: pass
    return {"current": "default", "projects": ["default"]}

def _save_project(data):
    with _project_lock:
        os.makedirs(os.path.dirname(PROJECT_FILE), exist_ok=True)
        with open(PROJECT_FILE, "w") as f:
            json.dump(data, f, indent=2)

SESSION_DIR = str(SESSIONS_DIR)
UPLOAD_DIR = str(CFG_UPLOADS_DIR)
SESSION_CACHE = {}
SESSION_CACHE_TTL = 1800

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
    if not os.path.exists(fpath) and os.path.exists(str(SESSION_DIR)):
        for sub in os.listdir(str(SESSION_DIR)):
            subdir = os.path.join(str(SESSION_DIR), sub)
            if os.path.isdir(subdir):
                candidate = os.path.join(subdir, f"{safe}.json")
                if os.path.exists(candidate):
                    return candidate
    return fpath

def _load_session_file(path):
    with _session_file_lock:
        if os.path.exists(path):
            with open(path) as f:
                return json.load(f)
    return {"messages": []}

def _save_session_file(path, data):
    with _session_file_lock:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)

def _merge_session_messages(existing, incoming):
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
    return merged

def get_agent_file_names(agent_id):
    from agents import AGENTS
    files = set()
    dir_path = os.path.join(UPLOAD_DIR, agent_id)
    if os.path.exists(dir_path):
        files.update(os.listdir(dir_path))
    if agent_id == "ceo":
        for a in AGENTS:
            d = os.path.join(UPLOAD_DIR, a["id"])
            if os.path.exists(d):
                files.update(os.listdir(d))
    if agent_id != "ceo":
        ceo_path = os.path.join(UPLOAD_DIR, "ceo")
        if os.path.exists(ceo_path):
            files.update(os.listdir(ceo_path))
    return sorted(files)

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
        if GREEK_LANG not in base_prompt:
            base_prompt += f"\n\n{GREEK_LANG}"
        memory_context = get_context_for_agent(agent_id)
        if memory_context:
            base_prompt += f"\n\nΣΗΜΕΙΩΣΕΙΣ ΑΠΟ ΜΝΗΜΗ:\n{memory_context}"
        summaries = get_summaries(agent_id, limit=2)
        if summaries:
            summ_text = "\n".join(f"- {s['text'][:300]}" for s in summaries)
            base_prompt += f"\n\nΠΕΡΙΛΗΨΕΙΣ ΠΡΟΗΓΟΥΜΕΝΩΝ ΣΥΝΟΜΙΛΙΩΝ:\n{summ_text}"
        if agent_id == "ceo":
            ceo_view = get_agents()
            parts = ["\n\nΟΙ AGENTS ΣΟΥ (Η ΟΜΑΔΑ ΣΟΥ):"]
            for a in ceo_view:
                parts.append(f"  {a['icon']} {a['name']} ({a['id']}) — {a['role']}")
            base_prompt += "\n".join(parts)
        uploaded = get_agent_file_names(agent_id)
        if uploaded:
            base_prompt += f"\n\nΑΝΕΒΑΣΜΕΝΑ ΑΡΧΕΙΑ (για {agent_id}):\n"
            for fname in uploaded:
                fpath = None
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

def sanitize_messages(messages):
    allowed = {"role", "content", "tool_calls", "tool_call_id", "name"}
    clean = []
    for m in messages:
        clean.append({k: v for k, v in m.items() if k in allowed})
    return clean

def _make_summary_block(non_system, keep_count=4):
    """Compress old messages into a summary block when context exceeds limit."""
    if len(non_system) <= keep_count + 2:
        return non_system[-MAX_CONTEXT_MSGS:]
    old = non_system[:-(keep_count + 2)]
    recent = non_system[-(keep_count + 2):]
    key_terms = set()
    for m in old:
        c = (m.get("content") or "")[:100]
        words = c.split()
        for w in words:
            if len(w) > 4:
                key_terms.add(w.lower())
    summary_text = f"[Σύνοψη προηγούμενων μηνυμάτων: {' '.join(list(key_terms)[:20])}]"
    summary_msg = {"role": "system", "content": f"ΠΡΟΗΓΟΥΜΕΝΟ ΠΛΑΙΣΙΟ: {summary_text}"}
    return [summary_msg] + recent[-MAX_CONTEXT_MSGS:]

def trim_messages(messages):
    system = [m for m in messages if m.get("role") == "system"]
    non_system = [m for m in messages if m.get("role") != "system"]
    if len(non_system) > MAX_CONTEXT_MSGS + 2:
        non_system = _make_summary_block(non_system)
    trimmed = non_system[-MAX_CONTEXT_MSGS:]
    return sanitize_messages(system + trimmed)

def run_agent(ctx, engine_override=""):
    if engine_override:
        engine = next((e for e in ENGINES if e["id"] == engine_override), None)
        if not engine:
            return {"response": f"Engine '{engine_override}' not found", "engine_used": "none", "tool_calls": []}
        engines_to_try = [engine]
    else:
        is_ceo = ctx.agent_id == "ceo"
        task_type = "reasoning" if is_ceo else ("simple" if not ctx.tools_enabled else "general")
        suggested = suggest_engine_for(task_type, needs_tools=ctx.tools_enabled)
        engines_to_try = get_active_engines(task_type=task_type, needs_tools=ctx.tools_enabled)
        if suggested and suggested in engines_to_try:
            engines_to_try = [suggested] + [e for e in engines_to_try if e["id"] != suggested["id"]]
        cached_id = session_engine_cache.get(ctx.session_id)
        if cached_id:
            cached = next((e for e in ENGINES if e["id"] == cached_id), None)
            if cached and cached in engines_to_try:
                engines_to_try = [cached] + [e for e in engines_to_try if e["id"] != cached_id]
    if not engines_to_try:
        return {"response": "Δεν υπάρχει διαθέσιμο engine. Έλεγξε API keys και engine status.", "engine_used": "none", "tool_calls": []}
    user_msgs = [m for m in ctx.messages if m.get("role") == "user"]
    last_user = user_msgs[-1]["content"] if user_msgs else ""
    is_simple = len(last_user) < 200 and not any(w in last_user for w in ["γράψε", "δημιούργησε", "ανέλυσε", "βρες", "ψάξε", "διάβασε", "run", "execute", "write", "create", "search", "find", "read", "ανάλυσε", "γράψε μου", "φτιάξε"])
    last_error = ""
    for engine in engines_to_try:
        if ctx.tools_enabled and not engine.get("supports_tools", False):
            continue
        for attempt in range(2):
            try:
                t0 = time.time()
                engine_id = engine["id"]
                msgs = trim_messages(ctx.messages)
                if is_simple and ctx.tools_enabled:
                    tools_for_call = get_tool_definitions_for_agent(ctx.agent_id)
                    resp = call_engine(engine, msgs, tools=tools_for_call, stream=False)
                    t1 = time.time()
                    data = resp.json()
                    choice = data["choices"][0]
                    msg = choice["message"]
                    record_engine_perf(engine_id, t1 - t0, True)
                    tool_calls = msg.get("tool_calls")
                    if not tool_calls:
                        from tools import parse_xml_tool_calls
                        tool_calls, cleaned = parse_xml_tool_calls(msg.get("content", ""))
                        if tool_calls:
                            msg["content"] = cleaned
                    if tool_calls:
                        ctx.add_message("assistant", msg.get("content") or "", tool_calls=tool_calls)
                        tool_results = []
                        for tc in tool_calls[:MAX_TOOL_ITER]:
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
                        t2 = time.time()
                        synthesis_type = "reasoning" if is_ceo else task_type
                        final_resp = call_engine(engine, trim_messages(ctx.messages), stream=False, task_type=synthesis_type)
                        t3 = time.time()
                        record_engine_perf(engine_id, t3 - t2, True)
                        final_data = final_resp.json()
                        final_text = final_data["choices"][0]["message"].get("content", "")
                        ctx.add_message("assistant", final_text)
                        session_engine_cache[ctx.session_id] = engine_id
                        return {"response": final_text, "engine_used": engine_id, "tool_calls": tool_results}
                    else:
                        text = msg.get("content", "")
                        ctx.add_message("assistant", text)
                        session_engine_cache[ctx.session_id] = engine_id
                        return {"response": text, "engine_used": engine_id, "tool_calls": []}
                tools_for_call = get_tool_definitions_for_agent(ctx.agent_id) if ctx.tools_enabled else None
                resp = call_engine(engine, msgs, tools=tools_for_call, stream=False)
                t1 = time.time()
                data = resp.json()
                choice = data["choices"][0]
                msg = choice["message"]
                record_engine_perf(engine_id, t1 - t0, True)
                if not msg.get("tool_calls"):
                    from tools import parse_xml_tool_calls
                    xml_tools, _clean = parse_xml_tool_calls(msg.get("content", ""))
                    if xml_tools:
                        msg["tool_calls"] = xml_tools
                        msg["content"] = _clean
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
                    t2 = time.time()
                    final_resp = call_engine(engine, trim_messages(ctx.messages), stream=False)
                    t3 = time.time()
                    record_engine_perf(engine_id, t3 - t2, True)
                    final_data = final_resp.json()
                    final_text = final_data["choices"][0]["message"].get("content", "")
                    ctx.add_message("assistant", final_text)
                    session_engine_cache[ctx.session_id] = engine_id
                    return {"response": final_text, "engine_used": engine_id, "tool_calls": tool_results}
                else:
                    text = msg.get("content", "")
                    ctx.add_message("assistant", text)
                    session_engine_cache[ctx.session_id] = engine_id
                    return {"response": text, "engine_used": engine_id, "tool_calls": []}
            except Exception as e:
                last_error = f"[{engine['id']}] {e}"
                record_engine_perf(engine["id"], 0, False)
                if "rate limit" in last_error.lower() or "too large" in last_error.lower():
                    mark_engine(engine["id"], "rate_limited", 300)
                    break
                continue
    return {"response": f"Σφάλμα σε όλα τα engines: {last_error}", "engine_used": "none", "tool_calls": []}
