import json, os, time
from datetime import datetime

AION_DIR = os.path.expanduser("~/AION")
MEMORY_FILE = os.path.join(AION_DIR, "MEMORY", "memory.json")
SESSION_DIR = os.path.join(AION_DIR, "aionclaw", "sessions")
SUMMARY_THRESHOLD = 6

def load_memory():
    try:
        os.makedirs(os.path.dirname(MEMORY_FILE), exist_ok=True)
        if os.path.exists(MEMORY_FILE):
            with open(MEMORY_FILE) as f:
                return json.load(f)
    except:
        pass
    return {}

def save_memory(data):
    try:
        os.makedirs(os.path.dirname(MEMORY_FILE), exist_ok=True)
        with open(MEMORY_FILE, "w") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        return True
    except:
        return False

def store_fact(key, value, agent_id="ceo", source="user"):
    mem = load_memory()
    if "facts" not in mem:
        mem["facts"] = {}
    mem["facts"][key] = {
        "value": value,
        "agent": agent_id,
        "source": source,
        "updated": datetime.now().isoformat(),
    }
    save_memory(mem)
    return True

def recall_fact(key):
    mem = load_memory()
    facts = mem.get("facts", {})
    exact = facts.get(key)
    if exact:
        return exact["value"]
    results = {}
    for k, v in facts.items():
        if key.lower() in k.lower():
            results[k] = v["value"]
    return results if results else None

def get_all_facts():
    mem = load_memory()
    return mem.get("facts", {})

def store_summary(agent_id, summary_text):
    mem = load_memory()
    if "summaries" not in mem:
        mem["summaries"] = {}
    if agent_id not in mem["summaries"]:
        mem["summaries"][agent_id] = []
    mem["summaries"][agent_id].append({
        "text": summary_text,
        "timestamp": datetime.now().isoformat(),
        "message_count": 0,
    })
    if len(mem["summaries"][agent_id]) > 20:
        mem["summaries"][agent_id] = mem["summaries"][agent_id][-20:]
    save_memory(mem)

def get_summaries(agent_id, limit=3):
    mem = load_memory()
    summaries = mem.get("summaries", {}).get(agent_id, [])
    return summaries[-limit:]

def get_context_for_agent(agent_id):
    mem = load_memory()
    context_parts = []

    # 1. Facts (shared across all agents)
    facts = mem.get("facts", {})
    agent_facts = {k: v["value"] for k, v in facts.items()}
    if agent_facts:
        context_parts.append("ΓΝΩΣΕΙΣ (από προηγούμενες συνομιλίες):")
        for k, v in list(agent_facts.items())[:10]:
            context_parts.append(f"- {k}: {v}")

    # 2. Agent-specific summaries
    summaries = mem.get("summaries", {}).get(agent_id, [])
    if summaries:
        context_parts.append(f"\nΠΡΟΗΓΟΥΜΕΝΕΣ ΣΥΝΟΜΙΛΙΕΣ ({agent_id}):")
        for s in summaries[-3:]:
            context_parts.append(f"- {s['text']}")

    # 3. CEO gets ALL summaries + recent sessions from ALL agents
    if agent_id == "ceo":
        # All summaries from all agents
        all_summaries = mem.get("summaries", {})
        for aid, sum_list in all_summaries.items():
            if aid != "ceo" and sum_list:
                context_parts.append(f"\nΣΥΝΟΨΕΙΣ ΑΠΟ {aid.upper()}:")
                for s in sum_list[-3:]:
                    context_parts.append(f"- {s['text']}")

        # Recent sessions from all agents
        if os.path.exists(SESSION_DIR):
            files = sorted(os.listdir(SESSION_DIR), reverse=True)[:15]
            for fname in files:
                if not fname.endswith(".json"):
                    continue
                fpath = os.path.join(SESSION_DIR, fname)
                try:
                    with open(fpath) as f:
                        data = json.load(f)
                    msgs = data.get("messages", [])
                    # Extract agent_id from filename (e.g. "dev_default.json" → "dev")
                    agent_from_file = fname.split("_")[0]
                    # Get last user+assistant exchange
                    last_pair = []
                    for m in reversed(msgs):
                        if m.get("role") in ("user", "assistant") and len(last_pair) < 2:
                            last_pair.insert(0, m)
                    if last_pair:
                        context_parts.append(f"\nΤΕΛΕΥΤΑΙΑ ΣΥΝΟΜΙΛΙΑ ΜΕ {agent_from_file.upper()} ({fname.replace('.json','')}):")
                        for m in last_pair:
                            content = (m.get("content") or "")[:200]
                            role_label = "Εσύ" if m["role"] == "user" else "Assistant"
                            context_parts.append(f"  {role_label}: {content}")
                except:
                    pass

    return "\n".join(context_parts) if context_parts else ""

def needs_summary(messages):
    return len([m for m in messages if m["role"] in ("user", "assistant")]) >= SUMMARY_THRESHOLD

async def summarize_conversation(engine_call_fn, engine, messages, agent_id):
    from engine import call_engine as ce
    chat_messages = [m for m in messages if m["role"] in ("user", "assistant")]
    if len(chat_messages) < 4:
        return

    text = "\n".join(f"{m['role']}: {m['content'][:500]}" for m in chat_messages[-10:])

    summary_prompt = [{
        "role": "system",
        "content": "Δημιούργησε μια σύντομη περίληψη (2-3 προτάσεις στα Ελληνικά) αυτής της συνομιλίας. Κράτα τα σημαντικά facts, requests, decisions."
    }, {
        "role": "user",
        "content": f"Περίληψε αυτή τη συνομιλή:\n\n{text}"
    }]

    try:
        resp = ce(engine, summary_prompt, tools=None, stream=False, max_tokens=200)
        data = resp.json()
        summary = data["choices"][0]["message"].get("content", "")
        if summary:
            store_summary(agent_id, summary)
            return summary
    except:
        pass
    return None
