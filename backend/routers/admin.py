import json, os, traceback, time
from datetime import datetime
from fastapi import APIRouter, HTTPException, Query, UploadFile, File, Form, Body
from fastapi.responses import FileResponse, JSONResponse, HTMLResponse, Response
from pydantic import BaseModel
from engine import ENGINES, get_engine_perf, get_engine_status, get_active_engines
from config import AION_DIR, DOTENV_FILE, COLLAB_LOG, UPLOADS_DIR as CFG_UPLOADS_DIR, LEADS_FILE
from shared import UPLOAD_DIR, _load_project, sessions

START_TIME = time.time()

router = APIRouter(tags=["admin"])

@router.get("/api/health")
async def health():
    active = get_active_engines()
    uptime_secs = int(time.time() - START_TIME)
    days, rem = divmod(uptime_secs, 86400)
    hours, rem = divmod(rem, 3600)
    mins, secs = divmod(rem, 60)
    return {
        "status": "ok",
        "version": "1.0.0",
        "time": datetime.now().isoformat(),
        "uptime": f"{days}d {hours}h {mins}m {secs}s",
        "uptime_seconds": uptime_secs,
        "active_sessions": len(sessions),
        "active_engines": len(active),
        "engines": [{"id": e["id"], "model": e.get("model", "")} for e in active[:6]],
    }

@router.get("/api/keys")
async def list_keys():
    env_path = str(DOTENV_FILE)
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

@router.post("/api/keys")
async def update_key(data: dict = Body(...)):
    engine_id = data.get("engine_id")
    api_key = data.get("api_key")
    if not engine_id or not api_key:
        raise HTTPException(400, "engine_id and api_key required")
    os.environ[f"{engine_id.upper()}_API_KEY"] = api_key
    env_path = str(DOTENV_FILE)
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

@router.get("/api/performance")
async def get_performance():
    from performance import get_report
    return get_report()

@router.get("/api/engine-perf")
async def get_engine_performance():
    return {"stats": get_engine_perf(), "engines": get_engine_status()}

@router.get("/api/agent-perf")
async def get_agent_perf():
    from performance import get_agent_summary
    return {"stats": get_agent_summary()}

@router.get("/api/activity")
async def get_activity(limit: int = Query(100)):
    from tools import read_activity
    return {"entries": read_activity(limit)}

@router.get("/api/collab/history")
async def collab_history():
    path = str(COLLAB_LOG)
    try:
        if os.path.exists(path):
            with open(path) as f:
                events = json.load(f)
            return {"events": events[-100:]}
    except:
        pass
    return {"events": []}

@router.post("/api/collab/clear")
async def collab_clear():
    path = str(COLLAB_LOG)
    try:
        from collaboration import bus
        bus.history = []
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w") as f:
            json.dump([], f)
        return {"ok": True}
    except Exception as e:
        return {"ok": False, "error": str(e)}

@router.get("/api/collab/reads")
async def collab_reads():
    from reads import get_reads
    return {"reads": get_reads()}

@router.post("/api/collab/events/{event_id}/read")
async def collab_event_read(event_id: str):
    from reads import mark_read
    mark_read(event_id)
    return {"ok": True}

@router.post("/api/collab/events/{event_id}/unread")
async def collab_event_unread(event_id: str):
    from reads import mark_unread
    mark_unread(event_id)
    return {"ok": True}

@router.post("/api/tunnel/start")
async def start_tunnel():
    from tunnel import start_tunnel as _start
    result = _start(port=9790)
    return result

@router.post("/api/tunnel/stop")
async def stop_tunnel():
    from tunnel import stop_tunnel as _stop
    result = _stop()
    return result

@router.get("/api/tunnel/status")
async def tunnel_status():
    from tunnel import get_tunnel_status
    return get_tunnel_status()
