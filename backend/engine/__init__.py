import json, os, time, threading
from datetime import datetime
from config import AION_DIR, MEMORY_DIR, PERF_FILE, ENGINE_STATUS_FILE, DOTENV_FILE
from engine_router import record_usage, tracker as token_tracker, DEFAULT_LIMITS

ENGINE_LOCK = threading.Lock()

# Engine perf cache (10s TTL, avoids file I/O on every scoring call)
_perf_cache = None
_perf_cache_ts = 0
PERF_CACHE_TTL = 10

def _load_perf_cached():
    global _perf_cache, _perf_cache_ts
    now = time.time()
    if _perf_cache is not None and now - _perf_cache_ts < PERF_CACHE_TTL:
        return _perf_cache
    try:
        if os.path.exists(PERF_FILE):
            with open(PERF_FILE) as f:
                _perf_cache = json.load(f)
                _perf_cache_ts = now
                return _perf_cache
    except: pass
    _perf_cache = {}
    _perf_cache_ts = now
    return _perf_cache

def _save_perf(data):
    global _perf_cache, _perf_cache_ts
    _perf_cache = data
    _perf_cache_ts = time.time()
    try:
        os.makedirs(os.path.dirname(PERF_FILE), exist_ok=True)
        with open(PERF_FILE, "w") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
    except: pass

def _load_env():
    env_file = str(DOTENV_FILE)
    if os.path.exists(env_file):
        with open(env_file) as f:
            for line in f:
                line = line.strip()
                if line.startswith("export "):
                    kv = line[7:].split("=", 1)
                    if len(kv) == 2:
                        os.environ[kv[0]] = kv[1].strip("\"'")

_load_env()

ENGINES = [
    {"id": "cerebras", "name": "Cerebras GPT-OSS-120B", "base_url": "https://api.cerebras.ai/v1", "model": "gpt-oss-120b",
     "priority": 1, "supports_tools": True, "max_tokens": 8192, "cooldown_until": 0, "headers": {},
     "capability": "high", "speed_rating": "fast", "suitable_for": ["general", "coding", "reasoning", "tools"]},
    {"id": "sambanova", "name": "SambaNova DeepSeek V3.1", "base_url": "https://api.sambanova.ai/v1", "model": "DeepSeek-V3.1",
     "priority": 9, "supports_tools": False, "max_tokens": 131072, "cooldown_until": 0, "headers": {},
     "capability": "medium", "speed_rating": "slow", "suitable_for": ["coding", "reasoning"]},
    {"id": "openrouter_deepseek", "name": "DeepSeek V4 Flash (OpenRouter)", "base_url": "https://openrouter.ai/api/v1", "model": "deepseek/deepseek-v4-flash",
     "priority": 1, "supports_tools": True, "max_tokens": 65536, "cooldown_until": 0, "headers": {"HTTP-Referer": "https://aion.gr", "X-Title": "AION"},
     "capability": "high", "speed_rating": "fast", "suitable_for": ["general", "coding", "reasoning", "tools"]},
    {"id": "openrouter", "name": "OpenRouter Owl Alpha", "base_url": "https://openrouter.ai/api/v1", "model": "openrouter/owl-alpha",
     "priority": 4, "supports_tools": True, "max_tokens": 65536, "cooldown_until": 0, "headers": {"HTTP-Referer": "https://aion.gr", "X-Title": "AION"},
     "capability": "high", "speed_rating": "medium", "suitable_for": ["general", "coding", "reasoning", "tools"]},
    {"id": "openrouter_llama", "name": "Llama 3.3 70B (OpenRouter)", "base_url": "https://openrouter.ai/api/v1", "model": "meta-llama/llama-3.3-70b-instruct:free",
     "priority": 5, "supports_tools": True, "max_tokens": 32768, "cooldown_until": 0, "headers": {"HTTP-Referer": "https://aion.gr", "X-Title": "AION"},
     "capability": "high", "speed_rating": "medium", "suitable_for": ["general", "reasoning", "tools"]},
    {"id": "groq", "name": "Groq Llama 3.3 70B", "base_url": "https://api.groq.com/openai/v1", "model": "llama-3.3-70b-versatile",
     "priority": 6, "supports_tools": True, "max_tokens": 8192, "cooldown_until": 0, "headers": {},
     "capability": "high", "speed_rating": "fast", "suitable_for": ["general", "reasoning", "tools"]},
    {"id": "groq_8b", "name": "Groq Llama 3.1 8B", "base_url": "https://api.groq.com/openai/v1", "model": "llama-3.1-8b-instant",
     "priority": 7, "supports_tools": True, "max_tokens": 131072, "cooldown_until": 0, "headers": {},
     "capability": "medium", "speed_rating": "very_fast", "suitable_for": ["simple", "quick_tasks", "tools"]},
    {"id": "gemini", "name": "Gemini 2.5 Flash", "base_url": "https://generativelanguage.googleapis.com/v1beta/openai", "model": "gemini-2.5-flash",
     "priority": 8, "supports_tools": True, "max_tokens": 8192, "cooldown_until": 0, "headers": {},
     "capability": "high", "speed_rating": "medium", "suitable_for": ["general", "reasoning", "tools"]},
      {"id": "ollama", "name": "Ollama Qwen 2.5 14B", "base_url": "http://127.0.0.1:11434/v1", "model": "qwen2.5:14b",
       "priority": 9, "supports_tools": True, "max_tokens": 16384, "status": "inactive", "cooldown_until": 0, "headers": {},
       "capability": "low", "speed_rating": "slow", "suitable_for": ["simple", "tools"], "disabled": True},
    {"id": "openrouter_qwen", "name": "Qwen3 Next 80B (OpenRouter)", "base_url": "https://openrouter.ai/api/v1", "model": "qwen/qwen3-next-80b-a3b-instruct:free",
     "priority": 3, "supports_tools": True, "max_tokens": 65536, "cooldown_until": 0, "headers": {"HTTP-Referer": "https://aion.gr", "X-Title": "AION"},
     "capability": "high", "speed_rating": "fast", "suitable_for": ["general", "coding", "reasoning", "tools"]},
    {"id": "openrouter_gemma", "name": "Gemma 4 31B (OpenRouter)", "base_url": "https://openrouter.ai/api/v1", "model": "google/gemma-4-31b-it:free",
     "priority": 3, "supports_tools": True, "max_tokens": 16384, "cooldown_until": 0, "headers": {"HTTP-Referer": "https://aion.gr", "X-Title": "AION"},
     "capability": "high", "speed_rating": "fast", "suitable_for": ["general", "reasoning", "tools"]},
    {"id": "openrouter_nemotron", "name": "Nemotron Nano 9B (OpenRouter)", "base_url": "https://openrouter.ai/api/v1", "model": "nvidia/nemotron-nano-9b-v2:free",
     "priority": 8, "supports_tools": True, "max_tokens": 16384, "cooldown_until": 0, "headers": {"HTTP-Referer": "https://aion.gr", "X-Title": "AION"},
     "capability": "low", "speed_rating": "medium", "suitable_for": ["simple", "quick_tasks"]},
]

# Remove permanently disabled engines
ENGINES = [e for e in ENGINES if e.get("status") != "inactive"]

def get_api_key(engine_id):
    key = os.environ.get(f"{engine_id.upper()}_API_KEY", "")
    if key:
        return key
    FALLBACK_KEYS = {
        "cerebras": os.environ.get("CEREBRAS_API_KEY", "CEREBRAS_KEY_REMOVED"),
        "sambanova": os.environ.get("SAMBANOVA_API_KEY", "SAMBANOVA_KEY_REMOVED"),
        "openrouter": os.environ.get("OPENROUTER_API_KEY", ""),
        "openrouter_deepseek": os.environ.get("OPENROUTER_API_KEY", ""),
        "openrouter_llama": os.environ.get("OPENROUTER_API_KEY", ""),
        "openrouter_qwen": os.environ.get("OPENROUTER_API_KEY", ""),
        "openrouter_gemma": os.environ.get("OPENROUTER_API_KEY", ""),
        "openrouter_nemotron": os.environ.get("OPENROUTER_API_KEY", ""),
        "groq": os.environ.get("GROQ_API_KEY", ""),
        "groq_8b": os.environ.get("GROQ_API_KEY", ""),
        "gemini": os.environ.get("GEMINI_API_KEY", ""),
        "ollama": os.environ.get("OLLAMA_API_KEY", ""),
    }
    return FALLBACK_KEYS.get(engine_id, "")

def _load_perf():
    return _load_perf_cached()

def _save_perf(data):
    try:
        os.makedirs(os.path.dirname(PERF_FILE), exist_ok=True)
        with open(PERF_FILE, "w") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
    except: pass

def record_engine_perf(engine_id, duration_s, success):
    data = _load_perf()
    if engine_id not in data:
        data[engine_id] = {"calls": 0, "total_time": 0, "successes": 0, "failures": 0, "avg_time": 0}
    d = data[engine_id]
    d["calls"] += 1
    d["total_time"] += duration_s
    if success:
        d["successes"] += 1
        _consecutive_failures[engine_id] = 0
        record_usage(engine_id)  # track token usage
    else:
        d["failures"] += 1
        cf = _consecutive_failures.get(engine_id, 0) + 1
        _consecutive_failures[engine_id] = cf
        if cf >= ENGINE_FALLBACK_THRESHOLD:
            mark_engine(engine_id, "degraded", ENGINE_FALLBACK_COOLDOWN)
            _consecutive_failures[engine_id] = 0
    d["avg_time"] = round(d["total_time"] / d["calls"], 2)
    d["success_rate"] = round(d["successes"] / d["calls"] * 100, 1)
    d["last_used"] = datetime.now().isoformat()
    _save_perf(data)

def get_engine_perf():
    return _load_perf()

SPEED_WEIGHTS = {"very_fast": 1, "fast": 2, "medium": 3, "slow": 4}

def get_engine_score(engine, task_type="general"):
    perf = _load_perf()
    eid = engine["id"]
    score = 0
    p = perf.get(eid, {})
    calls = p.get("calls", 0)
    weight = min(calls / 10.0, 1.0) if calls > 0 else 1.0
    if calls > 0:
        success_rate = p.get("success_rate", 100)
        avg_time = p.get("avg_time", 20)
        score += success_rate * 10 * weight
        score += max(0, 200 - avg_time * 10) * weight
    score += 500
    if task_type in engine.get("suitable_for", []):
        score += 300
    # Speed is PRIMARY factor — dominate so fastest engines always win unless badly degraded
    speed = SPEED_WEIGHTS.get(engine.get("speed_rating", "medium"), 3)
    score += (6 - speed) * 2000  # very_fast=+10000, fast=+8000, medium=+6000, slow=+4000
    if task_type == "simple" and engine["capability"] == "low":
        score += 200
    if task_type in ("coding", "reasoning", "tools") and engine["capability"] == "high":
        score += 200
    score += (10 - engine["priority"]) * 10
    # Reliability bonus: non-OpenRouter engines with dedicated API keys go FIRST
    if eid == "cerebras":
        score += 2000  # reliable, fast, supports tools
    elif eid == "gemini":
        score += 1500  # reliable Google free tier
    elif eid in ("groq", "groq_8b"):
        score += 500   # dedicated key but rate limited (30/min)
    elif eid == "sambanova":
        score += 300   # no tools, slow but reliable
    # OpenRouter engines that may still have quota
    if eid in ("openrouter", "openrouter_deepseek"):
        score += 200
    # Penalise free OpenRouter models that frequently hit daily limits
    if eid in ("openrouter_nemotron", "openrouter_qwen", "openrouter_gemma", "openrouter_llama"):
        score -= 2000  # tried LAST, after all other options exhausted
    # Token quota penalty: reduce score as engines approach their daily limit
    try:
        usage = token_tracker.get_usage(eid)
        pct = usage["pct"]
        if pct >= 90:
            score -= 5000  # almost exhausted, strongly deprioritize
        elif pct >= 75:
            score -= 2000  # getting close, reduce priority
        elif pct >= 50:
            score -= 500
    except:
        pass
    return score

def suggest_engine_for(task_type="general", needs_tools=True):
    now = time.time()
    best = None
    best_score = -1
    for e in ENGINES:
        if e.get("status") == "inactive":
            continue
        status = e.get("status", "active")
        if status not in ("active", None) and e.get("cooldown_until", 0) > now:
            continue
        if needs_tools and not e["supports_tools"]:
            continue
        if not get_api_key(e["id"]):
            continue
        s = get_engine_score(e, task_type)
        if s > best_score:
            best_score = s
            best = e
    return best

def get_active_engines(task_type=None, needs_tools=None):
    now = time.time()
    scored = []
    for e in ENGINES:
        if e.get("status") == "inactive":
            continue
        status = e.get("status", "active")
        if status not in ("active", None) and e.get("cooldown_until", 0) > now:
            continue
        if needs_tools is not None and needs_tools != e["supports_tools"]:
            continue
        if not get_api_key(e["id"]):
            continue
        # Allow env var override for local engines (e.g. OLLAMA_BASE_URL for remote ollama)
        env_base = os.environ.get(f"{e['id'].upper()}_BASE_URL", "")
        if env_base:
            e["base_url"] = env_base
        # Always score by speed + performance, never by raw priority
        s = get_engine_score(e, task_type or "general")
        scored.append((s, e))
    scored.sort(key=lambda x: x[0], reverse=True)
    return [e for _, e in scored]

def load_engine_status():
    now = time.time()
    path = str(ENGINE_STATUS_FILE)
    try:
        if os.path.exists(path):
            with open(path) as f:
                data = json.load(f)
                status_map = {e["id"]: e for e in data}
                changed = False
                for e in ENGINES:
                    s = status_map.get(e["id"], {})
                    status = s.get("status", "active")
                    cooldown = s.get("cooldown_until", 0)
                    if status not in ("active", "inactive") and cooldown <= now:
                        status = "active"
                        cooldown = 0
                        changed = True
                    # Permanently inactive engines stay inactive regardless
                    if e.get("status") == "inactive":
                        status = "inactive"
                        cooldown = 0
                        changed = True
                    e["status"] = status
                    e["cooldown_until"] = cooldown
                if changed:
                    save_engine_status()
    except: pass

def save_engine_status():
    path = str(ENGINE_STATUS_FILE)
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        data = [{"id": e["id"], "status": e.get("status", "active"), "cooldown_until": e.get("cooldown_until", 0)} for e in ENGINES]
        with open(path, "w") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
    except: pass

def mark_engine(engine_id, status, cooldown_secs=60):
    for e in ENGINES:
        if e["id"] == engine_id:
            e["status"] = status
            e["cooldown_until"] = time.time() + cooldown_secs if status in ("rate_limited", "quota_exhausted", "timeout", "error") else 0
            break
    save_engine_status()

# Proactive rate limiting — prevent calling engines too fast
RATE_LIMITS = {
    "cerebras": {"max_calls": 30, "window": 60},
    "sambanova": {"max_calls": 20, "window": 60},
    "openrouter_deepseek": {"max_calls": 20, "window": 60},
    "openrouter": {"max_calls": 20, "window": 60},
    "openrouter_llama": {"max_calls": 20, "window": 60},
    "openrouter_qwen": {"max_calls": 20, "window": 60},
    "openrouter_gemma": {"max_calls": 20, "window": 60},
    "openrouter_nemotron": {"max_calls": 30, "window": 60},
    "groq": {"max_calls": 30, "window": 60},
    "groq_8b": {"max_calls": 30, "window": 60},
    "gemini": {"max_calls": 15, "window": 60},
    "ollama": {"max_calls": 1000, "window": 60},
}

_call_history = {}

# Auto fallback — consecutive failure tracking
_consecutive_failures = {}
ENGINE_FALLBACK_THRESHOLD = 2
ENGINE_FALLBACK_COOLDOWN = 600  # 10min after 2 consecutive failures

def check_rate_limit(engine_id):
    now = time.time()
    limits = RATE_LIMITS.get(engine_id, {"max_calls": 30, "window": 60})
    history = _call_history.get(engine_id, [])
    history = [t for t in history if now - t < limits["window"]]
    _call_history[engine_id] = history
    if len(history) >= limits["max_calls"]:
        wait = limits["window"] - (now - history[0]) + 1
        return False, wait
    return True, 0

def record_call(engine_id):
    if engine_id not in _call_history:
        _call_history[engine_id] = []
    _call_history[engine_id].append(time.time())

def get_rate_limit_info(engine_id):
    limits = RATE_LIMITS.get(engine_id, {"max_calls": 30, "window": 60})
    now = time.time()
    history = _call_history.get(engine_id, [])
    recent = [t for t in history if now - t < limits["window"]]
    allowed, wait = check_rate_limit(engine_id)
    return {
        "max_calls": limits["max_calls"],
        "window_s": limits["window"],
        "calls_in_window": len(recent),
        "throttled": not allowed,
        "wait_seconds": round(wait, 1),
    }

def get_engine_status():
    now = time.time()
    result = []
    for e in sorted(ENGINES, key=lambda x: x["priority"]):
        status = "active" if not e.get("status") or e["status"] == "active" or e.get("cooldown_until", 0) <= now else e["status"]
        rl_info = get_rate_limit_info(e["id"])
        result.append({
            "id": e["id"],
            "name": e["name"],
            "model": e["model"],
            "priority": e["priority"],
            "status": status,
            "supports_tools": e["supports_tools"],
            "max_tokens": e["max_tokens"],
            "capability": e["capability"],
            "speed_rating": e["speed_rating"],
            "cooldown_until": e.get("cooldown_until", 0),
            "rate_limit": rl_info,
        })
    return result

def call_engine(engine, messages, tools=None, stream=False, max_tokens=None, task_type=None):
    import requests
    api_key = get_api_key(engine["id"])
    if not api_key:
        raise ValueError(f"API key not set for {engine['id']}")

    allowed, wait = check_rate_limit(engine["id"])
    if not allowed:
        mark_engine(engine["id"], "rate_limited", wait)
        raise Exception(f"Rate limited: {engine['id']} — retry in {wait:.0f}s")

    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    headers.update(engine.get("headers", {}))

    if max_tokens is None:
        if task_type == "simple":
            max_tokens = 512
        elif task_type == "reasoning":
            max_tokens = 4096
        elif task_type == "coding":
            max_tokens = 4096
        elif task_type == "general":
            max_tokens = 2048
        elif task_type == "tools":
            max_tokens = 4096
        else:
            max_tokens = min(engine.get("max_tokens", 4096), 2048)

    body = {
        "model": engine["model"],
        "messages": messages,
        "max_tokens": max_tokens or min(engine.get("max_tokens", 4096), 2048),
        "stream": stream,
    }
    if tools and engine["supports_tools"]:
        body["tools"] = tools

    if stream:
        conn_to = 5 if task_type != "simple" else 3
        read_to = 15 if task_type != "simple" else 8
        resp = requests.post(
            f"{engine['base_url']}/chat/completions",
            headers=headers, json=body, timeout=(conn_to, read_to), stream=True
        )
    else:
        conn_to = 4 if task_type != "simple" else 2
        read_to = 10 if task_type != "simple" else 5
        resp = requests.post(
            f"{engine['base_url']}/chat/completions",
            headers=headers, json=body, timeout=(conn_to, read_to)
        )

    if resp.status_code != 200:
        error_msg = resp.text[:500]
        if "free-models-per-day" in error_msg.lower() or "daily" in error_msg.lower() and "limit" in error_msg.lower():
            mark_engine(engine["id"], "quota_exhausted", 86400)  # 24h for daily limits
        elif "rate limit" in error_msg.lower() or resp.status_code == 429 or "413" in error_msg:
            mark_engine(engine["id"], "rate_limited", 300)  # 5min for rate limits
        elif "quota" in error_msg.lower() or "billing" in error_msg.lower():
            mark_engine(engine["id"], "quota_exhausted", 7200)
        elif resp.status_code in (502, 503):
            mark_engine(engine["id"], "timeout", 120)
        raise Exception(f"API error {resp.status_code}: {error_msg}")

    record_call(engine["id"])
    return resp

load_engine_status()
