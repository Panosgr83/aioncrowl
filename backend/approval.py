import json, os, uuid
from datetime import datetime

AION_DIR = os.path.expanduser("~/AION")
APPROVAL_FILE = os.path.join(AION_DIR, "MEMORY", "approvals.json")

def get_all():
    try:
        if os.path.exists(APPROVAL_FILE):
            with open(APPROVAL_FILE) as f:
                return json.load(f)
    except:
        pass
    return []

def _save(all_reqs):
    os.makedirs(os.path.dirname(APPROVAL_FILE), exist_ok=True)
    with open(APPROVAL_FILE, "w") as f:
        json.dump(all_reqs[-100:], f, indent=2, ensure_ascii=False)

def create(agent_id, summary, details=""):
    req = {
        "id": str(uuid.uuid4())[:8],
        "agent_id": agent_id,
        "summary": summary,
        "details": details[:3000],
        "status": "pending",
        "ts": datetime.now().isoformat(),
    }
    all_reqs = get_all()
    all_reqs.append(req)
    _save(all_reqs)
    return req

def get_pending():
    return [r for r in get_all() if r["status"] == "pending"]

def approve(req_id, approved_by="user"):
    all_reqs = get_all()
    for req in all_reqs:
        if req["id"] == req_id and req["status"] == "pending":
            req["status"] = "approved"
            req["approved_by"] = approved_by
            req["approved_at"] = datetime.now().isoformat()
            _save(all_reqs)
            return req
    return None

def reject(req_id):
    all_reqs = get_all()
    for req in all_reqs:
        if req["id"] == req_id and req["status"] == "pending":
            req["status"] = "rejected"
            req["rejected_at"] = datetime.now().isoformat()
            _save(all_reqs)
            return req
    return None
