import json, os
from datetime import datetime

PERF_FILE = os.path.join(os.path.expanduser("~/AION"), "MEMORY", "performance.json")

TIME_ESTIMATES = {
    "dev": 30, "leadfinder": 25, "sales": 20, "marketing": 20, "support": 15,
    "analytics": 30, "security": 20, "finance": 20, "memory": 10, "ceo": 15,
    "imggen": 35, "seo": 20, "offers": 20, "consultant": 20, "docsagent": 25,
}

def get_eta(agent_id, steps=1):
    base = TIME_ESTIMATES.get(agent_id, 20)
    return base * steps

def log_performance(agent_id, task, duration_s, engine_used, success, tool_calls=0, task_type=""):
    data = _load()
    data.append({
        "ts": datetime.now().isoformat(),
        "agent_id": agent_id,
        "task": task[:100],
        "duration_s": round(duration_s, 2),
        "engine": engine_used or "unknown",
        "success": success,
        "tool_calls": tool_calls,
        "task_type": task_type,
    })
    if len(data) > 1000:
        data = data[-1000:]
    _save(data)

def get_report():
    data = _load()
    if not data:
        return {"report": "Δεν υπάρχουν δεδομένα απόδοσης ακόμα.", "suggestions": [], "agent_stats": {}, "engine_stats": {}}

    agent_stats = {}
    engine_stats = {}
    for entry in data:
        aid = entry["agent_id"]
        if aid not in agent_stats:
            agent_stats[aid] = {"count": 0, "total_time": 0, "failures": 0}
        agent_stats[aid]["count"] += 1
        agent_stats[aid]["total_time"] += entry["duration_s"]
        if not entry["success"]:
            agent_stats[aid]["failures"] += 1

        eng = entry.get("engine", "unknown")
        if eng not in engine_stats:
            engine_stats[eng] = {"count": 0, "total_time": 0, "failures": 0}
        engine_stats[eng]["count"] += 1
        engine_stats[eng]["total_time"] += entry["duration_s"]
        if not entry["success"]:
            engine_stats[eng]["failures"] += 1

    lines = []
    suggestions = []
    for aid, s in sorted(agent_stats.items()):
        avg = s["total_time"] / s["count"]
        fail_rate = s["failures"] / s["count"] * 100
        status = "⚡" if avg < 10 else "✅" if avg < 20 else "⚠️" if avg < 30 else "🐢"
        lines.append(f"  {status} {aid}: avg {avg:.1f}s, {s['count']} tasks, {fail_rate:.0f}% fails")
        if avg > 25:
            suggestions.append(f"⚠️ {aid} είναι αργός (avg {avg:.1f}s). Δοκίμασε απλούστερα tasks ή έλεγξε τα engines.")
        if fail_rate > 20:
            suggestions.append(f"❌ {aid} έχει υψηλό ποσοστό αποτυχίας ({fail_rate:.0f}%). Έλεγξε ρυθμίσεις engine.")

    elines = []
    for eng, s in sorted(engine_stats.items()):
        avg = s["total_time"] / s["count"]
        fail_rate = s["failures"] / s["count"] * 100
        status = "⚡" if avg < 8 else "✅" if avg < 15 else "⚠️"
        elines.append(f"  {status} {eng}: avg {avg:.1f}s, {s['count']} calls, {fail_rate:.0f}% fails")
        if fail_rate > 15:
            suggestions.append(f"⚠️ Engine {eng} έχει {fail_rate:.0f}% αποτυχίες — πιθανό rate limiting ή timeout.")

    report = "📊 ΑΝΑΦΟΡΑ ΑΠΟΔΟΣΗΣ\n"
    report += "─" * 40 + "\n"
    report += f"Σύνολο: {len(data)} κλήσεις\n\n"
    report += "Ανά Agent:\n" + "\n".join(lines) + "\n\n"
    report += "Ανά Engine:\n" + "\n".join(elines) + "\n"
    if suggestions:
        report += "\nΠροτάσεις Βελτιστοποίησης:\n" + "\n".join(suggestions)

    return {"report": report, "suggestions": suggestions, "agent_stats": agent_stats, "engine_stats": engine_stats}

def _load():
    try:
        if os.path.exists(PERF_FILE):
            with open(PERF_FILE) as f:
                return json.load(f)
    except:
        pass
    return []

def _save(data):
    try:
        os.makedirs(os.path.dirname(PERF_FILE), exist_ok=True)
        with open(PERF_FILE, "w") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
    except:
        pass
