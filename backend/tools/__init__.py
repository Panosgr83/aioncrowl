import json, os, subprocess, requests, time, asyncio, threading
from datetime import datetime

AION_DIR = os.path.expanduser("~/AION")
MEMORY_FILE = os.path.join(AION_DIR, "MEMORY", "memory.json")
PERF_START = {}
MEMORY_LOCK = threading.Lock()
ACTIVITY_FILE = os.path.join(AION_DIR, "MEMORY", "activity.jsonl")

def log_activity(agent_id, tool, args, result, success=True):
    try:
        os.makedirs(os.path.dirname(ACTIVITY_FILE), exist_ok=True)
        entry = {
            "ts": datetime.now().isoformat(),
            "agent": agent_id,
            "tool": tool,
            "args": str(args)[:200],
            "result": str(result)[:300],
            "success": success,
        }
        with open(ACTIVITY_FILE, "a") as f:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")
    except:
        pass

def read_activity(limit=100):
    try:
        if not os.path.exists(ACTIVITY_FILE):
            return []
        entries = []
        with open(ACTIVITY_FILE) as f:
            for line in f:
                line = line.strip()
                if line:
                    try:
                        entries.append(json.loads(line))
                    except:
                        pass
        return entries[-limit:]
    except:
        return []

def store_collab_memory(agent_id, task, result):
    mem = load_memory()
    if "collaborations" not in mem:
        mem["collaborations"] = []
    mem["collaborations"].append({
        "agent": agent_id,
        "task": task[:300],
        "result": result[:500],
        "timestamp": datetime.now().isoformat(),
    })
    if len(mem["collaborations"]) > 100:
        mem["collaborations"] = mem["collaborations"][-100:]
    save_memory(mem)

def load_memory():
    with MEMORY_LOCK:
        try:
            os.makedirs(os.path.dirname(MEMORY_FILE), exist_ok=True)
            if os.path.exists(MEMORY_FILE):
                with open(MEMORY_FILE) as f:
                    return json.load(f)
        except:
            pass
        return {}

def save_memory(data):
    with MEMORY_LOCK:
        try:
            os.makedirs(os.path.dirname(MEMORY_FILE), exist_ok=True)
            with open(MEMORY_FILE, "w") as f:
                json.dump(data, f, indent=2, ensure_ascii=False)
            return "OK"
        except Exception as e:
            return f"σφάλμα: {e}"

def _get_facts(mem):
    return mem.get("facts", {})

def _ensure_facts(mem):
    if "facts" not in mem:
        mem["facts"] = {}
    return mem["facts"]

TOOL_DEFINITIONS = [
    {
        "type": "function",
        "function": {
            "name": "read_file",
            "description": "Διάβασε περιεχόμενο αρχείου. Path must be absolute or under ~/AION.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Απόλυτο path ή σχετικό με ~/AION"}
                },
                "required": ["path"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "write_file",
            "description": "Γράψε περιεχόμενο σε αρχείο. Δημιουργεί το αρχείο αν δεν υπάρχει.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Απόλυτο path ή σχετικό με ~/AION"},
                    "content": {"type": "string", "description": "Περιεχόμενο προς εγγραφή"}
                },
                "required": ["path", "content"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "list_dir",
            "description": "Λίστα αρχείων σε directory.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Απόλυτο path ή σχετικό με ~/AION"}
                },
                "required": ["path"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "run_command",
            "description": "Εκτέλεσε command στο terminal.",
            "parameters": {
                "type": "object",
                "properties": {
                    "command": {"type": "string", "description": "Command προς εκτέλεση"},
                    "timeout": {"type": "number", "description": "Timeout σε δευτερόλεπτα"}
                },
                "required": ["command"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "web_search",
            "description": "Αναζήτηση στο web.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Search query"}
                },
                "required": ["query"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "web_fetch",
            "description": "Διάβασε περιεχόμενο από URL.",
            "parameters": {
                "type": "object",
                "properties": {
                    "url": {"type": "string", "description": "URL προς ανάγνωση"},
                    "format": {"type": "string", "enum": ["markdown", "text", "html"], "description": "Μορφή εξόδου"}
                },
                "required": ["url"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "remember",
            "description": "Αποθήκευσε μια πληροφορία στη μνήμη.",
            "parameters": {
                "type": "object",
                "properties": {
                    "key": {"type": "string", "description": "Όνομα της πληροφορίας"},
                    "value": {"type": "string", "description": "Τιμή"}
                },
                "required": ["key", "value"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "recall",
            "description": "Ανάκτησε πληροφορία από τη μνήμη.",
            "parameters": {
                "type": "object",
                "properties": {
                    "key": {"type": "string", "description": "Όνομα προς αναζήτηση"}
                },
                "required": ["key"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "list_memories",
            "description": "Δες όλες τις αποθηκευμένες πληροφορίες.",
            "parameters": {
                "type": "object",
                "properties": {}
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "read_leads",
            "description": "Διάβασε leads από το CRM database.",
            "parameters": {
                "type": "object",
                "properties": {
                    "search": {"type": "string", "description": "Προαιρετική αναζήτηση"},
                    "limit": {"type": "number", "description": "Αριθμός leads (default 10)"}
                }
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_time",
            "description": "Τρέχουσα ώρα και ημερομηνία.",
            "parameters": {"type": "object", "properties": {}}
        }
    },
    {
        "type": "function",
        "function": {
            "name": "send_to_agent",
            "description": "ΣΤΕΙΛΕ μήνυμα σε άλλο agent. Χρησιμοποιείται για επικοινωνία μεταξύ agents (π.χ. Developer → Lead Finder, ή οποιοσδήποτε agent → CEO). Ο παραλήπτης agent θα επεξεργαστεί το μήνυμα και θα απαντήσει.",
            "parameters": {
                "type": "object",
                "properties": {
                    "agent_id": {
                        "type": "string",
                        "enum": ["dev", "leadfinder", "memory", "sales", "marketing", "support", "analytics", "security", "finance", "imggen", "seo", "offers", "consultant", "docsagent", "ceo"],
                        "description": "Ποιος agent θα λάβει το μήνυμα"
                    },
                    "message": {"type": "string", "description": "Το μήνυμα προς τον agent"},
                    "context": {"type": "string", "description": "Πρόσθετες πληροφορίες context"}
                },
                "required": ["agent_id", "message"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "send_file_to_agent",
            "description": "ΣΤΕΙΛΕ ένα αρχείο σε άλλο agent. Το αρχείο θα αντιγραφεί στο φάκελο του παραλήπτη και θα είναι διαθέσιμο προς ανάγνωση. Χρησιμοποίησέ το για να μοιραστείς αποτελέσματα web search, reports, ή άλλα αρχεία.",
            "parameters": {
                "type": "object",
                "properties": {
                    "agent_id": {
                        "type": "string",
                        "enum": ["ceo", "dev", "leadfinder", "memory", "sales", "marketing", "support", "analytics", "security", "finance", "imggen", "seo", "offers", "consultant", "docsagent"],
                        "description": "Σε ποιον agent να σταλεί το αρχείο"
                    },
                    "file_path": {"type": "string", "description": "Απόλυτο path του αρχείου προς αποστολή"},
                    "rename": {"type": "string", "description": "Προαιρετικό: νέο όνομα για το αρχείο στον παραλήπτη"}
                },
                "required": ["agent_id", "file_path"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "list_agents",
            "description": "Δες όλους τους διαθέσιμους agents στο σύστημα, τις δυνατότητές τους και τα εργαλεία τους.",
            "parameters": {"type": "object", "properties": {}}
        }
    },
    {
        "type": "function",
        "function": {
            "name": "delegate_to_agent",
            "description": "ΑΝΑΘΕΣΕ εργασία σε άλλο agent. Ο CEO το χρησιμοποιεί για να συντονίζει την ομάδα. Ο sub-agent θα επεξεργαστεί την εργασία και θα επιστρέψει αποτέλεσμα.",
            "parameters": {
                "type": "object",
                "properties": {
                    "agent_id": {
                        "type": "string",
                        "enum": ["dev", "leadfinder", "memory", "sales", "marketing", "support", "analytics", "security", "finance", "imggen", "seo", "offers", "consultant", "docsagent"],
                        "description": "Ποιος agent θα εκτελέσει την εργασία"
                    },
                    "task": {"type": "string", "description": "Τι θέλεις να κάνει (αναλυτική περιγραφή)"},
                    "context": {"type": "string", "description": "Πρόσθετες πληροφορίες context"}
                },
                "required": ["agent_id", "task"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "parallel_delegate",
            "description": "ΑΝΑΘΕΣΕ εργασίες σε ΠΟΛΛΟΥΣ agents ταυτόχρονα. Χρησιμοποίησέ το όταν θέλεις πολλοί agents να δουλέψουν παράλληλα (π.χ. dev + security + analytics μαζί). Οι agents τρέχουν ταυτόχρονα και επιστρέφουν όλα τα αποτελέσματα.",
            "parameters": {
                "type": "object",
                "properties": {
                    "delegations": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "agent_id": {
                                    "type": "string",
                                    "enum": ["dev", "leadfinder", "memory", "sales", "marketing", "support", "analytics", "security", "finance", "imggen", "seo", "offers", "consultant", "docsagent"],
                                    "description": "Ποιος agent θα εκτελέσει την εργασία"
                                },
                                "task": {"type": "string", "description": "Τι θέλεις να κάνει (αναλυτική περιγραφή)"},
                                "context": {"type": "string", "description": "Πρόσθετες πληροφορίες context (προαιρετικό)"}
                            },
                            "required": ["agent_id", "task"]
                        },
                        "description": "Λίστα από εργασίες προς εκτέλεση παράλληλα"
                    },
                    "synthesize": {"type": "boolean", "description": "Αν θέλεις να συνθέσεις τα αποτελέσματα σε ενιαία απάντηση (true) ή να τα επιστρέψεις ξεχωριστά (false, default)"}
                },
                "required": ["delegations"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "request_approval",
            "description": "ΖΗΤΑ έγκριση για μακροσκελή απάντηση. Χρησιμοποίησέ το όταν πρέπει να γράψεις εκτενή ανάλυση (>500 λέξεις). Το αίτημα πάει στον χρήστη ΚΑΙ στον CEO. Περίμενε έγκριση πριν συνεχίσεις.",
            "parameters": {
                "type": "object",
                "properties": {
                    "summary": {"type": "string", "description": "Σύντομη περίληψη του τι θέλεις να αναλύσεις (1-2 προτάσεις)"},
                    "details": {"type": "string", "description": "Αναλυτική περιγραφή του τι θα γράψεις"}
                },
                "required": ["summary"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "approve_request",
            "description": "ΕΓΚΡΙΝΕ ένα αίτημα έγκρισης από άλλο agent. Μόλις εγκριθεί, ο agent θα συνεχίσει με την πλήρη ανάλυση.",
            "parameters": {
                "type": "object",
                "properties": {
                    "request_id": {"type": "string", "description": "Το ID του αιτήματος προς έγκριση"}
                },
                "required": ["request_id"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "query_kb",
            "description": "Αναζήτησε στο Knowledge Base του project. Επιστρέφει σχετικά αποσπάσματα από αρχεία και σημειώσεις που έχουν αποθηκευτεί στο project ή στο global knowledge base.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Ερώτημα αναζήτησης (π.χ. 'brand guidelines', 'API endpoints', 'προσφορές')"},
                    "project": {"type": "string", "description": "Project name (προαιρετικό, default το τρέχον project)"}
                },
                "required": ["query"]
            }
        }
    },
]

def resolve_path(path, agent_id=None):
    p = os.path.realpath(os.path.expanduser(path))
    if not os.path.isabs(p):
        p = os.path.realpath(os.path.join(AION_DIR, p))
    allowed = [os.path.realpath(AION_DIR), os.path.realpath(os.path.expanduser("~/AION"))]
    if not any(p.startswith(root + "/") or p == root for root in allowed):
        raise PermissionError(f"Access denied: {p} is outside AION directory")
    return p

def find_uploaded_file(fname):
    """Search for a file across all agent upload directories."""
    from agents import AGENTS
    upload_base = os.path.join(os.path.expanduser("~/AION"), "aionclaw", "uploads")
    for a in AGENTS + [{"id": "ceo"}]:
        candidate = os.path.join(upload_base, a["id"], fname)
        if os.path.exists(candidate):
            return candidate
    # Also try as-is
    if os.path.exists(fname):
        return fname
    return None

def execute_tool(name, args, agent_id="agent"):
    try:
        result = _execute_tool_impl(name, args, agent_id)
        log_activity(agent_id, name, args, result, True)
        return result
    except subprocess.TimeoutExpired:
        result = "Command timed out"
        log_activity(agent_id, name, args, result, False)
        return result
    except Exception as e:
        result = f"Error in {name}: {str(e)}"
        log_activity(agent_id, name, args, result, False)
        return result

def _execute_tool_impl(name, args, agent_id="agent"):
    try:
        if name == "read_file":
            p = resolve_path(args["path"], agent_id)
            if not os.path.exists(p):
                found = find_uploaded_file(os.path.basename(args["path"]))
                if found:
                    p = found
                else:
                    return f"File not found: {p}"
            if p.endswith(".docx"):
                try:
                    from docx import Document
                    doc = Document(p)
                    text = "\n".join(p.text for p in doc.paragraphs)
                    return text or "(κενό Word αρχείο)"
                except ImportError:
                    return "Το python-docx δεν είναι εγκατεστημένο. Τρέξε: pip3 install python-docx"
                except Exception as e:
                    return f"Σφάλμα ανάγνωσης Word: {e}"
            with open(p) as f:
                return f.read()
        elif name == "write_file":
            p = resolve_path(args["path"], agent_id)
            os.makedirs(os.path.dirname(p), exist_ok=True)
            with open(p, "w") as f:
                f.write(args["content"])
            # Auto-index into knowledge base
            try:
                from kb import index_file, _get_current_project
                project = _get_current_project()
                index_file(project, p, agent_id)
            except:
                pass
            return f"Written: {p}"
        elif name == "list_dir":
            p = resolve_path(args["path"], agent_id)
            if not os.path.isdir(p):
                return f"Not a directory: {p}"
            items = os.listdir(p)
            return "\n".join(sorted(items))
        elif name == "run_command":
            ALLOWED_AGENTS = ("ceo", "dev", "analytics")
            if agent_id not in ALLOWED_AGENTS:
                return f"❌ Ο agent '{agent_id}' δεν έχει δικαίωμα εκτέλεσης εντολών. Μόνο: {', '.join(ALLOWED_AGENTS)}"
            BLOCKED_PATTERNS = ["rm -rf /", "dd if=", "mkfs", "> /dev/", ":(){ :|:& };:", "chmod 777", "sudo ", "> /etc/"]
            command = args["command"]
            for pattern in BLOCKED_PATTERNS:
                if pattern in command:
                    return f"❌ Blocked: '{pattern}' δεν επιτρέπεται"
            timeout = args.get("timeout", 30)
            result = subprocess.run(
                command, shell=True, capture_output=True, text=True, timeout=timeout
            )
            out = result.stdout[-3000:] if len(result.stdout) > 3000 else result.stdout
            err = result.stderr[-1000:] if len(result.stderr) > 1000 else result.stderr
            return (out + ("\n---STDERR---\n" + err if err else "")) or "(no output)"
        elif name == "web_search":
            perplexity_key = os.environ.get("PERPLEXITY_API_KEY", "")
            if not perplexity_key:
                perplexity_key = "PERPLEXITY_KEY_REMOVED"
            resp = requests.post(
                "https://api.perplexity.ai/chat/completions",
                headers={"Authorization": f"Bearer {perplexity_key}", "Content-Type": "application/json"},
                json={
                    "model": "sonar",
                    "messages": [
                        {"role": "system", "content": "Search the web and provide accurate results."},
                        {"role": "user", "content": args["query"]}
                    ],
                    "max_tokens": 2000,
                },
                timeout=30,
            )
            if resp.status_code == 200:
                return resp.json()["choices"][0]["message"]["content"]
            return f"Search error: {resp.status_code} {resp.text[:200]}"
        elif name == "web_fetch":
            fmt = args.get("format", "markdown")
            last_err = ""
            for attempt in range(3):
                resp = requests.get(args["url"], timeout=30, headers={"User-Agent": "AIONCLAW/1.0"})
                if resp.status_code == 200:
                    return resp.text[:5000]
                if resp.status_code in (429, 503):
                    wait = 2 ** attempt
                    time.sleep(wait)
                    last_err = f"{resp.status_code} (retry {attempt+1}/3 after {wait}s)"
                else:
                    return f"Fetch error: {resp.status_code}"
            return f"Fetch error: {last_err}"
        elif name == "remember":
            mem = load_memory()
            facts = _ensure_facts(mem)
            facts[args["key"]] = {
                "value": args["value"],
                "agent": "user",
                "source": "user",
                "updated": datetime.now().isoformat(),
            }
            result = save_memory(mem)
            return f"Αποθηκεύτηκε: {args['key']} = {args['value']}" if result == "OK" else f"Σφάλμα: {result}"
        elif name == "recall":
            mem = load_memory()
            facts = _get_facts(mem)
            key = args["key"]
            exact = facts.get(key)
            if exact:
                val = exact["value"] if isinstance(exact, dict) else exact
                return f"{key}: {val}"
            matches = {}
            for k, v in facts.items():
                if key.lower() in k.lower():
                    val = v["value"] if isinstance(v, dict) else v
                    matches[k] = val
            if matches:
                return "\n".join(f"{k}: {v}" for k, v in matches.items())
            return f"Δεν βρέθηκε: {key}"
        elif name == "list_memories":
            mem = load_memory()
            facts = _get_facts(mem)
            if not facts:
                return "Κενή μνήμη"
            lines = []
            for k, v in facts.items():
                val = v["value"] if isinstance(v, dict) else v
                lines.append(f"{k}: {val}")
            return "\n".join(lines)
        elif name == "read_leads":
            leads_file = os.path.join(AION_DIR, "AION_CONNECT_CRM", "leads", "leads-database.json")
            try:
                with open(leads_file) as f:
                    data = json.load(f)
                leads = data if isinstance(data, list) else data.get("leads", [])
                search = args.get("search", "").lower()
                limit = args.get("limit", 10)
                if search:
                    leads = [l for l in leads if search in json.dumps(l).lower()]
                leads = leads[:limit]
                if not leads:
                    return "Δεν βρέθηκαν leads"
                result = []
                for l in leads:
                    result.append(f"{l.get('name', l.get('company', '?'))} | {l.get('status', '?')} | {l.get('email', '')}")
                return "\n".join(result)
            except Exception as e:
                return f"Error reading leads: {e}"
        elif name == "get_time":
            return datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        elif name == "delegate_to_agent":
            from agents import AGENTS
            from collaboration import bus, run_sub_agent, save_to_agent_session
            from performance import get_eta
            agent_id = args["agent_id"]
            known_ids = {a["id"] for a in AGENTS}
            if agent_id not in known_ids:
                available = ", ".join(sorted(known_ids))
                return f"❌ Ο agent '{agent_id}' ΔΕΝ υπάρχει στο σύστημα. Διαθέσιμοι agents: {available}. Χρησιμοποίησε list_agents για να δεις την ομάδα."
            task = args["task"]
            context = args.get("context", "")
            estimated_seconds = get_eta(agent_id)
            started_at = datetime.now().isoformat()
            PERF_START[f"delegate_{agent_id}"] = time.time()
            bus.status(agent_id, True, "writing")
            bus.log("ceo", agent_id, "delegate", f"Ανάθεση: {task[:200]}...")
            # Progress: start
            bus.broadcast({
                "type": "task_progress",
                "agent_id": agent_id,
                "status": "started",
                "progress": 0,
                "message": f"🚀 {agent_id} ξεκινά... (~{estimated_seconds}s)",
                "estimated_seconds": estimated_seconds,
                "remaining_seconds": estimated_seconds,
                "started_at": started_at,
                "ts": datetime.now().isoformat(),
            })
            bus.broadcast({
                "type": "agent_thinking",
                "agent_id": agent_id,
                "status": "started",
                "thought": f"🚀 {agent_id}: ξεκινά εργασία (εκτίμ. {estimated_seconds}s)",
                "estimated_seconds": estimated_seconds,
                "started_at": started_at,
                "ts": datetime.now().isoformat(),
            })
            result = run_sub_agent(agent_id, task, context)
            duration = time.time() - PERF_START.pop(f"delegate_{agent_id}", time.time())
            # Progress: done
            bus.broadcast({
                "type": "task_progress",
                "agent_id": agent_id,
                "status": "complete",
                "progress": 100,
                "message": f"✅ {agent_id} ολοκλήρωσε ({duration:.1f}s)",
                "estimated_seconds": estimated_seconds,
                "duration_s": round(duration, 1),
                "started_at": started_at,
                "ts": datetime.now().isoformat(),
            })
            bus.log(agent_id, "ceo", "result", result[:500])
            bus.status(agent_id, False, "has_response")
            store_collab_memory(agent_id, task, result)
            save_to_agent_session(agent_id, "default", f"Από CEO: {task}", result)
            # Broadcast real-time chat message to update agent's chat live
            bus.broadcast({
                "type": "agent_chat",
                "agent_id": agent_id,
                "session_id": "default",
                "exchange": [
                    {"role": "user", "content": f"Από CEO: {task}", "_aid": agent_id, "_sid": "default"},
                    {"role": "assistant", "content": result[:2000], "_aid": agent_id, "_sid": "default"}
                ]
            })
            return f"Αποτέλεσμα από {agent_id} ({duration:.1f}s):\n\n{result}"
        elif name == "parallel_delegate":
            from agents import AGENTS
            from collaboration import bus, run_sub_agent, save_to_agent_session
            from concurrent.futures import ThreadPoolExecutor, as_completed
            delegations = args["delegations"]
            synthesize = args.get("synthesize", False)
            known_ids = {a["id"] for a in AGENTS}
            validated = []
            for d in delegations:
                aid = d["agent_id"]
                if aid not in known_ids:
                    return f"❌ Ο agent '{aid}' ΔΕΝ υπάρχει στο σύστημα. Διαθέσιμοι: {', '.join(sorted(known_ids))}"
                validated.append((aid, d["task"], d.get("context", "")))
            bus.log("ceo", ", ".join(a for a,_,_ in validated), "parallel_delegate", f"Παράλληλη ανάθεση σε {len(validated)} agents")
            total = len(validated)
            results = {}
            with ThreadPoolExecutor(max_workers=total) as pool:
                fut_map = {}
                for aid, task, ctx in validated:
                    bus.status(aid, True, "writing")
                    bus.broadcast({
                        "type": "agent_thinking",
                        "agent_id": aid,
                        "status": "started",
                        "thought": f"🚀 {aid}: ξεκινά παράλληλα με {total} agents"
                    })
                    fut = pool.submit(run_sub_agent, aid, task, ctx)
                    fut_map[fut] = (aid, task)
                for fut in as_completed(fut_map):
                    aid, task = fut_map[fut]
                    try:
                        result = fut.result(timeout=300)
                        results[aid] = result
                        bus.status(aid, False, "has_response")
                        bus.broadcast({
                            "type": "agent_thinking",
                            "agent_id": aid,
                            "status": "complete",
                            "thought": f"✅ {aid} ολοκλήρωσε παράλληλα"
                        })
                        store_collab_memory(aid, task, result)
                        save_to_agent_session(aid, "default", f"Παράλληλο από CEO: {task}", result)
                    except Exception as e:
                        results[aid] = f"❌ Σφάλμα: {e}"
                        bus.broadcast({
                            "type": "agent_thinking",
                            "agent_id": aid,
                            "status": "error",
                            "thought": f"❌ {aid} απέτυχε: {str(e)[:100]}"
                        })
            if synthesize:
                combined = "## Παράλληλα Αποτελέσματα\n\n"
                for aid, r in results.items():
                    combined += f"### {aid}\n{r[:2000]}\n\n"
                return combined
            parts = [f"**{aid}** ({len(r)} chars): {r[:500]}" for aid, r in results.items()]
            return f"Παράλληλη εκτέλεση {len(results)} agents:\n" + "\n---\n".join(parts)
        elif name == "send_to_agent":
            from agents import AGENTS
            from collaboration import bus, run_sub_agent, save_to_agent_session
            from performance import get_eta
            to_agent = args["agent_id"]
            known_ids = {a["id"] for a in AGENTS}
            if to_agent not in known_ids:
                available = ", ".join(sorted(known_ids))
                return f"❌ Ο agent '{to_agent}' ΔΕΝ υπάρχει στο σύστημα. Διαθέσιμοι agents: {available}. Χρησιμοποίησε list_agents για να δεις την ομάδα."
            msg = args["message"]
            ctx_extra = args.get("context", "")
            task_with_context = f"{msg}\n\nContext: {ctx_extra}" if ctx_extra else msg
            estimated_seconds = get_eta(to_agent)
            started_at = datetime.now().isoformat()
            PERF_START[f"send_{to_agent}"] = time.time()
            bus.status(to_agent, True, "writing")
            bus.log("ceo", to_agent, "forward", f"Μήνυμα: {msg[:200]}...")
            bus.broadcast({
                "type": "agent_thinking",
                "agent_id": to_agent,
                "status": "started",
                "thought": f"📨 {to_agent}: επεξεργάζεται μήνυμα (εκτίμ. {estimated_seconds}s)",
                "estimated_seconds": estimated_seconds,
                "started_at": started_at,
                "ts": datetime.now().isoformat(),
            })
            result = run_sub_agent(to_agent, task_with_context)
            duration = time.time() - PERF_START.pop(f"send_{to_agent}", time.time())
            bus.status(to_agent, False, "has_response")
            save_to_agent_session(to_agent, "default", f"Από CEO: {msg}", result)
            bus.broadcast({
                "type": "agent_chat",
                "agent_id": to_agent,
                "session_id": "default",
                "exchange": [
                    {"role": "user", "content": f"Από CEO: {msg}", "_aid": to_agent, "_sid": "default"},
                    {"role": "assistant", "content": result[:2000], "_aid": to_agent, "_sid": "default"}
                ]
            })
            bus.log(to_agent, "ceo", "reply", result[:500])
            return f"Απάντηση από {to_agent} ({duration:.1f}s):\n\n{result}"
        elif name == "send_file_to_agent":
            from agents import AGENTS
            from collaboration import bus
            to_agent = args["agent_id"]
            known_ids = {a["id"] for a in AGENTS} | {"ceo"}
            if to_agent not in known_ids:
                available = ", ".join(sorted(known_ids))
                return f"❌ Ο agent '{to_agent}' ΔΕΝ υπάρχει. Διαθέσιμοι: {available}."
            src = resolve_path(args["file_path"])
            if not os.path.exists(src):
                found = find_uploaded_file(os.path.basename(args["file_path"]))
                if found:
                    src = found
                else:
                    return f"File not found: {args['file_path']}"
            dest_name = args.get("rename") or os.path.basename(src)
            dest_dir = os.path.join(os.path.expanduser("~/AION"), "aionclaw", "uploads", to_agent)
            os.makedirs(dest_dir, exist_ok=True)
            dest = os.path.join(dest_dir, dest_name)
            import shutil
            shutil.copy2(src, dest)
            fsize = os.path.getsize(dest)
            bus.log("agent", to_agent, "file_sent", f"Αρχείο: {dest_name} ({fsize} bytes)")
            bus.broadcast({
                "type": "agent_chat",
                "agent_id": to_agent,
                "session_id": "default",
                "exchange": [
                    {"role": "user", "content": f"📎 Λήψη αρχείου: {dest_name} ({fsize} bytes)", "_aid": to_agent, "_sid": "default"}
                ]
            })
            # Update agent_files in frontend via collab broadcast
            bus.broadcast({
                "type": "file_updated",
                "agent_id": to_agent,
                "filename": dest_name,
            })
            return f"Το αρχείο {dest_name} στάλθηκε στον {to_agent} ({fsize} bytes). Ο παραλήπτης μπορεί να το διαβάσει με read_file('{dest}')"
        elif name == "list_agents":
            from agents import AGENTS
            lines = [f"Σύστημα έχει {len(AGENTS)} agents:",
                     "─" * 40]
            for a in AGENTS:
                tools_list = ", ".join(a.get("tools", [])[:6])
                lines.append(f"  {a['icon']} {a['name']} ({a['id']})")
                lines.append(f"     Ρόλος: {a['role']}")
                lines.append(f"     Εργαλεία: {tools_list}")
            return "\n".join(lines)
        elif name == "request_approval":
            from approval import create as create_approval, approve as approve_req
            from collaboration import bus, run_sub_agent, save_to_agent_session
            summary = args["summary"]
            details = args.get("details", "")
            req = create_approval(agent_id, summary, details)
            # Auto-approve immediately — no waiting
            approved = approve_req(req["id"], "system")
            bus.broadcast({
                "type": "approval_request",
                "id": req["id"],
                "request_id": req["id"],
                "agent_id": agent_id,
                "summary": summary,
                "details": details[:500],
                "ts": req["ts"],
                "auto_approved": True,
            })
            bus.broadcast({
                "type": "approval_result",
                "request_id": req["id"],
                "status": "approved",
                "auto_approved": True,
                "ts": datetime.now().isoformat(),
            })
            # Continue with full analysis
            full_result = run_sub_agent(agent_id,
                f"✅ Αίτημα έγκρισης #{req['id']} ΕΓΚΡΙΘΗΚΕ ΑΥΤΟΜΑΤΑ.\n"
                f"Θέμα: {summary}\n\n"
                f"Συνέχισε ΤΩΡΑ με την πλήρη ανάλυση όπως είχες προγραμματίσει. "
                f"Γράψε λεπτομερώς και εκτενώς.")
            save_to_agent_session(agent_id, "default",
                f"✅ Αυτόμ. έγκριση #{req['id']} για: {summary}", full_result)
            bus.broadcast({
                "type": "agent_chat",
                "agent_id": agent_id,
                "session_id": "default",
                "exchange": [
                    {"role": "user", "content": f"✅ Αυτόμ. έγκριση #{req['id']} — {summary}", "_aid": agent_id, "_sid": "default"},
                    {"role": "assistant", "content": full_result[:3000], "_aid": agent_id, "_sid": "default"},
                ]
            })
            return (f"✅ Αίτημα #{req['id']} εγκρίθηκε αυτόματα.\n\n"
                    f"Αποτέλεσμα:\n{full_result[:2000]}")
        elif name == "approve_request":
            from approval import approve as approve_req
            from approval import get_all
            from collaboration import bus, run_sub_agent, save_to_agent_session
            req_id = args["request_id"]
            req = approve_req(req_id, "ceo")
            if not req:
                return f"Δεν βρέθηκε εκκρεμές αίτημα: {req_id}"
            bus.broadcast({
                "type": "approval_result",
                "request_id": req_id,
                "status": "approved",
                "ts": datetime.now().isoformat(),
            })
            agent_id = req.get("agent_id", "dev")
            full_result = run_sub_agent(agent_id,
                f"✅ Το αίτημα έγκρισης #{req_id} ΕΓΚΡΙΘΗΚΕ. "
                f"Θέμα: {req['summary']}\n\n"
                f"Συνέχισε ΤΩΡΑ με την πλήρη ανάλυση όπως είχες προγραμματίσει. "
                f"Γράψε λεπτομερώς και εκτενώς.")
            save_to_agent_session(agent_id, "default",
                f"✅ Έγκριση #{req_id} για: {req['summary']}", full_result)
            bus.broadcast({
                "type": "agent_chat",
                "agent_id": agent_id,
                "session_id": "default",
                "exchange": [
                    {"role": "user", "content": f"✅ Έγκριση #{req_id} — {req['summary']}", "_aid": agent_id, "_sid": "default"},
                    {"role": "assistant", "content": full_result[:3000], "_aid": agent_id, "_sid": "default"},
                ]
            })
            return (f"Το αίτημα #{req_id} εγκρίθηκε. Ο agent {agent_id} ξεκίνησε την ανάλυση.\n\n"
                    f"Αποτέλεσμα:\n{full_result[:2000]}")
        elif name == "query_kb":
            from kb import query_knowledge, format_kb_results
            q = args["query"]
            project = args.get("project", "")
            results = query_knowledge(project=project if project else None, query=q)
            return format_kb_results(results, q)
        return f"Unknown tool: {name}"
    except subprocess.TimeoutExpired as e:
        raise e
    except Exception as e:
        raise e
