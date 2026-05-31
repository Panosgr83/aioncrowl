import os, threading, time

AION_DIR = os.path.expanduser("~/AION")
TUNNEL_STATUS = {"active": False, "url": None, "error": None, "method": None}
_tunnel_thread = None
_stop_event = threading.Event()

def _get_env_var(name):
    val = os.environ.get(name, "")
    if val:
        return val
    env_path = os.path.join(AION_DIR, ".env")
    try:
        if os.path.exists(env_path):
            with open(env_path) as f:
                for line in f:
                    line = line.strip()
                    if line.startswith("export ") and f"{name}=" in line:
                        kv = line[7:].split("=", 1)
                        if len(kv) == 2:
                            return kv[1].strip("\"'")
    except:
        pass
    return ""

def _run_ngrok(port: int):
    try:
        from pyngrok import ngrok, conf
        token = _get_env_var("NGROK_AUTH_TOKEN")
        if token:
            conf.get_default().auth_token = token
        tunnel = ngrok.connect(port, "http", bind_tls=True)
        TUNNEL_STATUS["url"] = tunnel.public_url
        TUNNEL_STATUS["method"] = "ngrok"
        TUNNEL_STATUS["active"] = True
        TUNNEL_STATUS["error"] = None
        while not _stop_event.is_set():
            _stop_event.wait(1)
        try:
            ngrok.disconnect(tunnel.public_url)
        except:
            pass
        ngrok.kill()
    except Exception as e:
        # If endpoint already exists, kill and retry once
        if "already online" in str(e):
            ngrok.kill()
            import time
            time.sleep(2)
            try:
                tunnel = ngrok.connect(port, "http", bind_tls=True)
                TUNNEL_STATUS["url"] = tunnel.public_url
                TUNNEL_STATUS["method"] = "ngrok"
                TUNNEL_STATUS["active"] = True
                TUNNEL_STATUS["error"] = None
                return
            except Exception as e2:
                TUNNEL_STATUS["error"] = f"ngrok failed (retry): {e2}"
        else:
            TUNNEL_STATUS["error"] = f"ngrok failed: {e}"
        TUNNEL_STATUS["active"] = False

def start_tunnel(port: int = 9790):
    global _tunnel_thread, _stop_event
    if TUNNEL_STATUS["active"]:
        return TUNNEL_STATUS

    _stop_event.clear()
    TUNNEL_STATUS["active"] = False
    TUNNEL_STATUS["url"] = None
    TUNNEL_STATUS["error"] = None
    TUNNEL_STATUS["method"] = None

    token = _get_env_var("NGROK_AUTH_TOKEN")
    if not token:
        TUNNEL_STATUS["error"] = "Set NGROK_AUTH_TOKEN in ~/AION/.env to enable remote access (get a free token at https://ngrok.com)"
        TUNNEL_STATUS["active"] = False
        return TUNNEL_STATUS

    _tunnel_thread = threading.Thread(target=_run_ngrok, args=(port,), daemon=True)
    _tunnel_thread.start()
    for _ in range(30):
        if TUNNEL_STATUS["url"] or TUNNEL_STATUS["error"]:
            break
        time.sleep(0.5)

    return TUNNEL_STATUS

def stop_tunnel():
    global _tunnel_thread
    _stop_event.set()
    TUNNEL_STATUS["active"] = False
    TUNNEL_STATUS["url"] = None
    TUNNEL_STATUS["method"] = None
    TUNNEL_STATUS["error"] = None
    _tunnel_thread = None
    return TUNNEL_STATUS

def get_tunnel_status():
    has_token = bool(_get_env_var("NGROK_AUTH_TOKEN"))
    return {**TUNNEL_STATUS, "token_configured": has_token}
