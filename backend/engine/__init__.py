import json, os, time, threading
from datetime import datetime

AION_DIR = os.path.expanduser("~/AION")

def _load_env():
    env_file = os.path.join(AION_DIR, ".env")
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
    {"id": "cerebras", "name": "Cerebras GPT-OSS-120B", "base_url": "https://api.cerebras.ai/v1", "model": "gpt-oss-120b", "priority": 1, "supports_tools": True, "max_tokens": 8192, "cooldown_until": 0, "headers": {}},
    {"id": "sambanova", "name": "SambaNova DeepSeek V3.1", "base_url": "https://api.sambanova.ai/v1", "model": "DeepSeek-V3.1", "priority": 2, "supports_tools": True, "max_tokens": 131072, "cooldown_until": 0, "headers": {}},
    {"id": "openrouter", "name": "OpenRouter Owl Alpha", "base_url": "https://openrouter.ai/api/v1", "model": "openrouter/owl-alpha", "priority": 3, "supports_tools": True, "max_tokens": 65536, "cooldown_until": 0, "headers": {"HTTP-Referer": "https://aion.gr", "X-Title": "AION"}},
    {"id": "openrouter_deepseek", "name": "OpenRouter DeepSeek V4 Flash", "base_url": "https://openrouter.ai/api/v1", "model": "deepseek/deepseek-v4-flash:free", "priority": 4, "supports_tools": True, "max_tokens": 65536, "cooldown_until": 0, "headers": {"HTTP-Referer": "https://aion.gr", "X-Title": "AION"}},
    {"id": "groq", "name": "Groq Llama 3.3 70B", "base_url": "https://api.groq.com/openai/v1", "model": "llama-3.3-70b-versatile", "priority": 6, "supports_tools": True, "max_tokens": 8192, "cooldown_until": 0, "headers": {}},
    {"id": "groq_8b", "name": "Groq Llama 3.1 8B", "base_url": "https://api.groq.com/openai/v1", "model": "llama-3.1-8b-instant", "priority": 7, "supports_tools": True, "max_tokens": 131072, "cooldown_until": 0, "headers": {}},
    {"id": "gemini", "name": "Gemini 2.5 Flash", "base_url": "https://generativelanguage.googleapis.com/v1beta/openai", "model": "gemini-2.5-flash", "priority": 8, "supports_tools": True, "max_tokens": 8192, "cooldown_until": 0, "headers": {}},
    {"id": "ollama", "name": "Ollama Llama 3.2 3B", "base_url": "http://127.0.0.1:11434/v1", "model": "llama3.2:3b", "priority": 9, "supports_tools": True, "max_tokens": 4096, "cooldown_until": 0, "headers": {}},
]

ENGINE_LOCK = threading.Lock()

def get_api_key(engine_id):
    key = os.environ.get(f"{engine_id.upper()}_API_KEY", "")
    if key:
        return key
    FALLBACK_KEYS = {
        "cerebras": os.environ.get("CEREBRAS_API_KEY", ""),
        "sambanova": os.environ.get("SAMBANOVA_API_KEY", ""),
        "openrouter": os.environ.get("OPENROUTER_API_KEY", "OPENROUTER_KEY_REMOVED"),
        "openrouter_deepseek": os.environ.get("OPENROUTER_API_KEY", "OPENROUTER_KEY_REMOVED"),
        "groq": os.environ.get("GROQ_API_KEY", "GROQ_KEY_REMOVED"),
        "groq_8b": os.environ.get("GROQ_API_KEY", "GROQ_KEY_REMOVED"),
        "gemini": os.environ.get("GEMINI_API_KEY", "GEMINI_KEY_REMOVED"),
        "perplexity": os.environ.get("PERPLEXITY_API_KEY", "PERPLEXITY_KEY_REMOVED"),
    }
    return FALLBACK_KEYS.get(engine_id, "")

def load_engine_status():
    path = os.path.join(AION_DIR, "engine_status.json")
    try:
        if os.path.exists(path):
            with open(path) as f:
                data = json.load(f)
                status_map = {e["id"]: e for e in data}
                for e in ENGINES:
                    s = status_map.get(e["id"], {})
                    e["status"] = s.get("status", "active")
                    e["cooldown_until"] = s.get("cooldown_until", 0)
    except:
        pass

def save_engine_status():
    path = os.path.join(AION_DIR, "engine_status.json")
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        data = [{"id": e["id"], "status": e.get("status", "active"), "cooldown_until": e.get("cooldown_until", 0)} for e in ENGINES]
        with open(path, "w") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
    except:
        pass

def mark_engine(engine_id, status, cooldown_secs=60):
    for e in ENGINES:
        if e["id"] == engine_id:
            e["status"] = status
            e["cooldown_until"] = time.time() + cooldown_secs if status in ("rate_limited", "quota_exhausted", "timeout", "error") else 0
            break
    save_engine_status()

def get_active_engines():
    now = time.time()
    return [e for e in sorted(ENGINES, key=lambda x: x["priority"]) if e.get("status") in ("active", None) or e.get("cooldown_until", 0) <= now]

def get_engine_status():
    now = time.time()
    result = []
    for e in sorted(ENGINES, key=lambda x: x["priority"]):
        status = "active" if not e.get("status") or e["status"] == "active" or e.get("cooldown_until", 0) <= now else e["status"]
        result.append({
            "id": e["id"],
            "name": e["name"],
            "model": e["model"],
            "priority": e["priority"],
            "status": status,
            "supports_tools": e["supports_tools"],
            "max_tokens": e["max_tokens"],
            "cooldown_until": e.get("cooldown_until", 0),
        })
    return result

def call_engine(engine, messages, tools=None, stream=False, max_tokens=None):
    import requests
    api_key = get_api_key(engine["id"])
    if not api_key:
        raise ValueError(f"API key not set for {engine['id']}")

    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    headers.update(engine.get("headers", {}))

    body = {
        "model": engine["model"],
        "messages": messages,
        "max_tokens": max_tokens or engine.get("max_tokens", 4096),
        "stream": stream,
    }
    if tools and engine["supports_tools"]:
        body["tools"] = tools

    resp = requests.post(
        f"{engine['base_url']}/chat/completions",
        headers=headers,
        json=body,
        timeout=120 if stream else 60,
        stream=stream,
    )

    if resp.status_code != 200:
        error_msg = resp.text[:500]
        if "rate limit" in error_msg.lower() or resp.status_code == 429 or "413" in error_msg:
            mark_engine(engine["id"], "rate_limited", 120)
        elif "quota" in error_msg.lower() or "billing" in error_msg.lower():
            mark_engine(engine["id"], "quota_exhausted", 3600)
        raise Exception(f"API error {resp.status_code}: {error_msg}")

    return resp

load_engine_status()
