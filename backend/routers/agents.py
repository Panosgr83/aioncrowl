import json, os
from datetime import datetime, timezone
from fastapi import APIRouter
from engine import ENGINES, get_active_engines, get_engine_status, get_engine_perf
from agents import get_agents
from collaboration import bus

router = APIRouter(tags=["agents"])

@router.get("/api/agents")
async def list_agents():
    return {"agents": get_agents()}

@router.get("/api/engines")
async def engines():
    active = get_active_engines()
    status_map = {e["id"]: e for e in ENGINES}
    result = []
    for e in active:
        entry = dict(e)
        entry["status"] = status_map.get(e["id"], {}).get("status", "active")
        result.append(entry)
    return {"engines": result}

@router.get("/api/agent-heartbeat")
async def get_agent_heartbeat():
    now = datetime.now(timezone.utc)
    last_seen = {}
    for e in reversed(bus.history):
        aid = e.get("agent_id") or e.get("from") or e.get("to")
        if aid and aid not in last_seen:
            try:
                ts = e.get("ts", "")
                if ts:
                    et = datetime.fromisoformat(ts.replace("Z", "+00:00"))
                    last_seen[aid] = int((now - et).total_seconds())
            except:
                last_seen[aid] = 0
    for e in reversed(bus.history):
        if e.get("type") == "agent_comm":
            for aid in (e.get("from"), e.get("to")):
                if aid and aid not in last_seen:
                    last_seen[aid] = 0
    return {"last_seen": last_seen}

@router.get("/api/comm-log")
async def get_comm_log(limit: int = 50):
    entries = []
    for e in bus.history:
        if e.get("type") == "agent_comm" and e.get("from") and e.get("to"):
            entries.append(e)
    return {"entries": entries[-limit:]}
