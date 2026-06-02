import json, os
from datetime import datetime
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import HTMLResponse
from collaboration import bus
from config import SESSIONS_DIR
from shared import sessions, _session_file, _cache_get, _cache_set, _cache_invalidate, SESSION_DIR, _load_session_file, _save_session_file, _merge_session_messages

router = APIRouter(tags=["sessions"])

@router.get("/api/sessions")
async def list_sessions():
    return {"sessions": list(sessions.keys()), "count": len(sessions)}

@router.delete("/api/sessions/{session_id}")
async def clear_session(session_id: str):
    if session_id in sessions:
        del sessions[session_id]
        return {"status": "cleared"}
    return {"status": "not_found"}

@router.get("/api/sessions/list/{agent_id}")
async def list_session_files(agent_id: str):
    from shared import _load_project
    pdata = _load_project()
    project = pdata.get("current", "default")
    sessions_list = []
    def scan_dir(pdir):
        if os.path.exists(pdir):
            for fname in os.listdir(pdir):
                if fname.endswith(".json") and fname.startswith(agent_id + "_"):
                    sid = fname[len(agent_id)+1:-5]
                    label = f"📱 Telegram — {sid.replace('telegram_','')}" if sid.startswith("telegram_") else sid
                    if not any(s["id"] == sid for s in sessions_list):
                        sessions_list.append({"id": sid, "label": label})
    scan_dir(os.path.join(str(SESSIONS_DIR), project))
    scan_dir(os.path.join(str(SESSIONS_DIR), "default"))
    if os.path.exists(str(SESSIONS_DIR)):
        for sub in sorted(os.listdir(str(SESSIONS_DIR))):
            subdir = os.path.join(str(SESSIONS_DIR), sub)
            if os.path.isdir(subdir) and sub != project and sub != "default":
                scan_dir(subdir)
    return {"sessions": sessions_list}

@router.post("/api/sessions/{full_key}/save")
async def save_session_messages(full_key: str, data: dict):
    path = _session_file(full_key)
    try:
        existing_data = _load_session_file(path)
        existing = existing_data.get("messages", [])
        incoming = data.get("messages", [])
        merged = _merge_session_messages(existing, incoming)
        payload = {"messages": merged}
        _save_session_file(path, payload)
        _cache_set(full_key, payload)
        return {"status": "saved", "count": len(merged)}
    except Exception as e:
        raise HTTPException(400, f"Save error: {e}")

@router.get("/api/sessions/{full_key}/load")
async def load_session_messages(full_key: str):
    cached = _cache_get(full_key)
    if cached:
        return cached
    path = _session_file(full_key)
    try:
        data = _load_session_file(path)
        if data.get("messages"):
            _cache_set(full_key, data)
        return data
    except Exception as e:
        return {"messages": [], "error": str(e)}

@router.get("/api/export/doc")
async def export_doc(session_id: str = "default", agent_id: str = "ceo"):
    from agents import get_agent
    from datetime import datetime
    session_path = _session_file(f"{agent_id}:{session_id}")
    if not os.path.exists(session_path):
        raise HTTPException(404, "Session not found")
    try:
        with open(session_path) as f:
            data = json.load(f)
    except:
        raise HTTPException(400, "Failed to read session")

    messages = data.get("messages", [])
    agent = get_agent(agent_id)
    aname = agent.get("name", agent_id) if agent else agent_id
    aicon = agent.get("icon", "🤖") if agent else "🤖"
    date = datetime.now().strftime("%Y-%m-%d_%H-%M")

    def fmt_ts(ts):
        try: return datetime.fromisoformat(ts.replace("Z","+00:00")).strftime("%H:%M:%S")
        except: return ""

    rows = ""
    for m in messages:
        role = m.get("role", "")
        content = (m.get("content","") or str(m.get("args","")) or m.get("result","") or "").replace("&","&amp;").replace("<","&lt;").replace(">","&gt;").replace("\n","<br>")
        ts = fmt_ts(m.get("ts",""))
        if role == "user":
            rows += f"""<tr><td style="padding:8pt 12pt;background:#f0f4ff;border-bottom:1px solid #e5e7eb"><strong style="color:#6366f1">👤 User</strong> <span style="color:#999;font-size:8pt">({ts})</span><br/>{content}</td></tr>"""
        elif role == "assistant":
            rows += f"""<tr><td style="padding:8pt 12pt;background:#fafbff;border-bottom:1px solid #e5e7eb"><strong style="color:#6366f1">🤖 {aname}</strong> <span style="color:#999;font-size:8pt">({ts})</span><br/>{content}</td></tr>"""
        elif role == "tool_use":
            rows += f"""<tr><td style="padding:6pt 12pt;background:#fffbeb;border-bottom:1px solid #e5e7eb;font-size:9pt"><span style="color:#d97706">🔧 {m.get("name","tool")}</span></td></tr>"""
        elif role == "tool_result":
            rows += f"""<tr><td style="padding:6pt 12pt;background:#fafafa;border-bottom:1px solid #e5e7eb;font-size:8pt;color:#666">{content[:300]}</td></tr>"""

    html = f"""<!DOCTYPE html>
<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
<head><meta charset="utf-8"><style>
body{{font-family:Calibri,'Segoe UI',Arial,sans-serif;font-size:11pt;line-height:1.5;color:#1a1a2e;max-width:210mm;margin:20mm auto;padding:0 15mm}}
h1{{font-size:18pt;font-weight:700;color:#6366f1;border-bottom:2px solid #6366f1;padding-bottom:6pt}}
table{{width:100%;border-collapse:collapse}}
</style></head><body>
<h1>{aicon} {aname}</h1>
<p style="color:#888;font-size:9pt">{date}</p>
<table>{rows}</table>
</body></html>"""

    return HTMLResponse(content=html, headers={
        "Content-Type": "application/msword",
        "Content-Disposition": f'attachment; filename="{aname}_{date}.doc"',
        "Access-Control-Expose-Headers": "Content-Disposition",
    })
