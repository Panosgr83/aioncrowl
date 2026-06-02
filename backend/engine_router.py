import json, os, time, threading
from datetime import datetime, date

from config import AION_DIR

TOKEN_FILE = str(AION_DIR / "token_usage.json")

# Default daily request limits per engine (adjustable)
DEFAULT_LIMITS = {
    "cerebras": 500,
    "gemini": 1500,
    "groq": 1000,
    "groq_8b": 1000,
    "sambanova": 500,
    "openrouter": 50,
    "openrouter_deepseek": 500,
    "openrouter_llama": 50,
    "openrouter_qwen": 50,
    "openrouter_gemma": 50,
    "openrouter_nemotron": 50,
    "ollama": 0,  # inactive
}

SORTED_ENGINES = [
    "cerebras",      # fastest, most reliable
    "gemini",
    "groq",
    "groq_8b",
    "sambanova",
    "openrouter_deepseek",
    "openrouter",
    "openrouter_qwen",
    "openrouter_gemma",
    "openrouter_llama",
    "openrouter_nemotron",
]

class TokenTracker:
    def __init__(self):
        self._data = self._load()
        self._lock = threading.Lock()

    def _load(self):
        try:
            if os.path.exists(TOKEN_FILE):
                with open(TOKEN_FILE) as f:
                    return json.load(f)
        except: pass
        return {"requests": {}, "last_reset": str(date.today())}

    def _save(self):
        try:
            os.makedirs(os.path.dirname(TOKEN_FILE), exist_ok=True)
            with open(TOKEN_FILE, "w") as f:
                json.dump(self._data, f, indent=2)
        except: pass

    def _ensure_today(self):
        today = str(date.today())
        if self._data.get("last_reset") != today:
            self._data["requests"] = {}
            self._data["last_reset"] = today
            self._save()

    def record_request(self, engine_id):
        with self._lock:
            self._ensure_today()
            reqs = self._data["requests"]
            reqs[engine_id] = reqs.get(engine_id, 0) + 1
            self._save()

    def get_usage(self, engine_id):
        self._ensure_today()
        count = self._data["requests"].get(engine_id, 0)
        limit = DEFAULT_LIMITS.get(engine_id, 50)
        return {"count": count, "limit": limit, "pct": round(count / max(limit, 1) * 100, 1)}

    def get_all_usage(self):
        self._ensure_today()
        result = {}
        for eid in DEFAULT_LIMITS:
            result[eid] = self.get_usage(eid)
        return result

    def is_available(self, engine_id):
        usage = self.get_usage(engine_id)
        return usage["count"] < usage["limit"] * 0.9  # 90% threshold

    def best_available(self, exclude=None):
        exclude = exclude or set()
        for eid in SORTED_ENGINES:
            if eid in exclude:
                continue
            if self.is_available(eid):
                return eid
        return None


tracker = TokenTracker()


class EngineRouter:
    """Background thread that monitors engine status & token usage."""

    def __init__(self):
        self._active = False
        self._thread = None

    def start(self):
        if self._thread and self._thread.is_alive():
            return
        self._active = True
        self._thread = threading.Thread(target=self._loop, daemon=True)
        self._thread.start()
        print(f"EngineRouter: started (check every 60s)")

    def stop(self):
        self._active = False
        print("EngineRouter: stopped")

    def _loop(self):
        while self._active:
            try:
                self._check_and_update()
            except Exception as e:
                print(f"EngineRouter error: {e}")
            for _ in range(60):
                if not self._active:
                    break
                time.sleep(1)

    def _check_and_update(self):
        from engine import ENGINES, save_engine_status
        now = time.time()
        usage = tracker.get_all_usage()
        changed = False

        for e in ENGINES:
            eid = e["id"]
            e_limit = DEFAULT_LIMITS.get(eid, 0)
            u = usage.get(eid, {"count": 0, "limit": 50})
            count = u["count"]
            limit = u["limit"]
            pct = count / max(limit, 1) * 100

            # Skip permanently inactive engines
            if e.get("status") == "inactive":
                continue

            # Reset expired cooldowns
            cooldown = e.get("cooldown_until", 0)
            if e["status"] in ("rate_limited", "timeout", "error") and cooldown <= now:
                e["status"] = "active"
                e["cooldown_until"] = 0
                changed = True

            # Pre-emptive switch at 90%: mark as "low_quota" (still usable but lower priority)
            if limit > 0 and pct >= 90 and e["status"] == "active":
                e["status"] = "low_quota"
                changed = True
                print(f"EngineRouter: {eid} at {pct:.0f}% quota → low_quota")

            # Mark as quota_exhausted at 100%
            if limit > 0 and count >= limit and e["status"] in ("active", "low_quota"):
                # Cooldown until midnight
                tomorrow = date.today().isoformat()
                cooldown_until = time.mktime(time.strptime(tomorrow, "%Y-%m-%d")) + 86400
                e["status"] = "quota_exhausted"
                e["cooldown_until"] = cooldown_until
                changed = True
                print(f"EngineRouter: {eid} quota exhausted → cooldown until {tomorrow}")

            # Reset quota_exhausted when cooldown expires
            if e["status"] == "quota_exhausted" and cooldown <= now:
                # Reset the counter for a new day
                self._reset_engine_today(eid)
                e["status"] = "active"
                e["cooldown_until"] = 0
                changed = True
                print(f"EngineRouter: {eid} quota reset → active")

        if changed:
            save_engine_status()

    def _reset_engine_today(self, engine_id):
        with tracker._lock:
            if engine_id in tracker._data.get("requests", {}):
                tracker._data["requests"][engine_id] = 0
                tracker._save()


router = EngineRouter()


def record_usage(engine_id):
    """Call after each successful API request to track token usage."""
    tracker.record_request(engine_id)


def get_engine_rank():
    """Returns list of engine IDs sorted by availability & speed."""
    usage = tracker.get_all_usage()
    result = []
    for eid in SORTED_ENGINES:
        u = usage.get(eid, {"count": 0, "limit": 50})
        pct = u["count"] / max(u["limit"], 1) * 100
        if pct >= 100:
            continue  # exhausted
        score = 100 - pct  # higher = more quota remaining
        # Penalize at 90%+
        if pct >= 90:
            score -= 50
        result.append((eid, score))
    return sorted(result, key=lambda x: -x[1])
