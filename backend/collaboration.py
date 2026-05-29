import json, os, uuid, asyncio
from datetime import datetime

AION_DIR = os.path.expanduser("~/AION")
MEMORY_FILE = os.path.join(AION_DIR, "MEMORY", "memory.json")
SESSION_DIR = os.path.join(AION_DIR, "aionclaw", "sessions")

class AgentBus:
    def __init__(self):
        self.connections = set()
        self.history = []

    def broadcast(self, msg):
        payload = json.dumps(msg, ensure_ascii=False)
        dead = set()
        for ws in self.connections:
            try:
                asyncio.ensure_future(ws.send_text(payload))
            except:
                dead.add(ws)
        self.connections -= dead

    def log(self, from_agent, to_agent, action, content, task_id=None):
        entry = {
            "id": str(uuid.uuid4())[:8],
            "from": from_agent,
            "to": to_agent,
            "action": action,
            "content": content[:2000] if content else "",
            "task_id": task_id or str(uuid.uuid4())[:8],
            "ts": datetime.now().isoformat(),
        }
        self.history.append(entry)
        self.broadcast(entry)
        self._persist(entry)
        return entry

    def status(self, agent_id, active, state=None):
        entry = {
            "type": "agent_status",
            "agent_id": agent_id,
            "active": active,
            "state": state or ("idle" if not active else "writing"),
            "ts": datetime.now().isoformat(),
        }
        self.broadcast(entry)
        return entry

    def _persist(self, entry):
        try:
            path = os.path.join(AION_DIR, "MEMORY", "collab_log.json")
            os.makedirs(os.path.dirname(path), exist_ok=True)
            log = []
            if os.path.exists(path):
                with open(path) as f:
                    log = json.load(f)
            log.append(entry)
            if len(log) > 500:
                log = log[-500:]
            with open(path, "w") as f:
                json.dump(log, f, indent=2, ensure_ascii=False)
        except:
            pass

    def get_task_log(self, task_id):
        path = os.path.join(AION_DIR, "MEMORY", "collab_log.json")
        try:
            if os.path.exists(path):
                with open(path) as f:
                    log = json.load(f)
                return [e for e in log if e["task_id"] == task_id]
        except:
            pass
        return []

bus = AgentBus()

def save_to_agent_session(agent_id, session_id, user_msg, assistant_msg):
    """Save a user+assistant exchange to an agent's session file."""
    full_key = f"{agent_id}:{session_id}"
    safe = full_key.replace(":", "_").replace("/", "_")
    # Get current project
    project = "default"
    try:
        pf = os.path.join(AION_DIR, "MEMORY", "project.json")
        if os.path.exists(pf):
            with open(pf) as f:
                pd = json.load(f)
                project = pd.get("current", "default")
    except: pass
    pdir = os.path.join(SESSION_DIR, project)
    fpath = os.path.join(pdir, f"{safe}.json")
    os.makedirs(pdir, exist_ok=True)
    try:
        existing = []
        if os.path.exists(fpath):
            with open(fpath) as f:
                data = json.load(f)
                existing = data.get("messages", [])
        existing.append({"role": "user", "content": user_msg, "_aid": agent_id, "_sid": session_id})
        existing.append({"role": "assistant", "content": assistant_msg, "_aid": agent_id, "_sid": session_id})
        with open(fpath, "w") as f:
            json.dump({"messages": existing}, f, indent=2, ensure_ascii=False)
    except:
        pass

def run_sub_agent(agent_id, task, context="", engine_override=""):
    from agents import get_agent
    from engine import get_active_engines, call_engine, ENGINES
    from tools import TOOL_DEFINITIONS, execute_tool

    agent = get_agent(agent_id)
    system_prompt = f"""Είσαι ο {agent['name']}.
{agent['system_prompt']}

Σου ανατέθηκε μια εργασία από τον CEO.
Εργασία: {task}

Πρόσθετο context: {context if context else '(κανένα)'}

Απάντησε πλήρως και με λεπτομέρειες. Χρησιμοποίησε τα εργαλεία σου όπου χρειάζεται."""

    messages = [{"role": "system", "content": system_prompt}, {"role": "user", "content": task}]

    active = get_active_engines()
    if not active:
        return "Δεν υπάρχει διαθέσιμο engine"

    engines_to_try = [e for e in ENGINES if e["id"] == engine_override] if engine_override else active
    last_error = ""
    total_steps = 0
    done_steps = 0

    # Estimate steps based on agent type
    step_estimates = {"dev": 4, "leadfinder": 3, "sales": 3, "marketing": 3, "support": 3,
                      "analytics": 4, "security": 3, "finance": 3, "memory": 2, "ceo": 3}
    total_steps = step_estimates.get(agent_id, 3)

    for engine in engines_to_try:
        try:
            resp = call_engine(engine, messages, tools=TOOL_DEFINITIONS, stream=False, max_tokens=2000)
            data = resp.json()
            choice = data["choices"][0]
            msg = choice["message"]
            text = msg.get("content", "")

            if msg.get("tool_calls"):
                num_tools = len(msg["tool_calls"])
                for i, tc in enumerate(msg["tool_calls"]):
                    done_steps += 1
                    pct = min(int(done_steps / total_steps * 100), 95)
                    if isinstance(tc, dict):
                        fn = tc.get("function", {}).get("name", "")
                        fa = json.loads(tc.get("function", {}).get("arguments", "{}"))
                        tid = tc.get("id", "")
                    else:
                        fn = tc.function.name
                        fa = json.loads(tc.function.arguments)
                        tid = tc.id
                    bus.broadcast({
                        "type": "task_progress",
                        "agent_id": agent_id,
                        "status": "running",
                        "progress": pct,
                        "message": f"🔧 {agent_id}: {fn} ({i+1}/{num_tools})",
                        "ts": datetime.now().isoformat(),
                    })
                    result = execute_tool(fn, fa)
                    messages.append({"role": "assistant", "content": "", "tool_calls": [tc]})
                    messages.append({"role": "tool", "content": result, "tool_call_id": tid})

                final_resp = call_engine(engine, messages, stream=False, max_tokens=2000)
                final_data = final_resp.json()
                text = final_data["choices"][0]["message"].get("content", "")

            return text
        except Exception as e:
            last_error = str(e)
            continue

    return f"Σφάλμα: {last_error}"
