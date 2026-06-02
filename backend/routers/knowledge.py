import json, os
from fastapi import APIRouter, HTTPException, Body, Query
from config import KB_ROOT, CRM_DIR, LEADS_FILE

router = APIRouter(tags=["knowledge"])

@router.get("/api/kb/{kb_type}")
async def list_kb(kb_type: str):
    kb_path = os.path.join(str(KB_ROOT), kb_type)
    items = []
    if os.path.exists(kb_path):
        for fname in os.listdir(kb_path):
            fpath = os.path.join(kb_path, fname)
            if os.path.isfile(fpath):
                items.append({"name": fname, "size": os.path.getsize(fpath), "modified": int(os.path.getmtime(fpath))})
    return {"items": items}

@router.post("/api/kb/{kb_type}")
async def save_kb_item(kb_type: str, data: dict = Body(...)):
    kb_dir = os.path.join(str(KB_ROOT), kb_type)
    os.makedirs(kb_dir, exist_ok=True)
    fname = data.get("name", "untitled.json")
    fpath = os.path.join(kb_dir, fname)
    with open(fpath, "w") as f:
        json.dump(data.get("content", data), f, indent=2, ensure_ascii=False)
    return {"status": "saved", "path": fpath}

@router.delete("/api/kb/{kb_type}/{fname}")
async def delete_kb_item(kb_type: str, fname: str):
    fpath = os.path.join(str(KB_ROOT), kb_type, fname)
    if os.path.exists(fpath):
        os.remove(fpath)
        return {"status": "deleted"}
    raise HTTPException(404, "Not found")

@router.get("/api/crm")
async def get_crm():
    if os.path.exists(str(CRM_DIR)):
        items = []
        for fname in os.listdir(str(CRM_DIR)):
            if fname.endswith(".json"):
                fpath = os.path.join(str(CRM_DIR), fname)
                try:
                    with open(fpath) as f:
                        items.append(json.load(f))
                except: pass
        return {"items": items}
    return {"items": []}

@router.post("/api/crm")
async def save_crm(data: dict = Body(...)):
    os.makedirs(str(CRM_DIR), exist_ok=True)
    import uuid
    cid = data.get("id", str(uuid.uuid4()))
    fpath = os.path.join(str(CRM_DIR), f"{cid}.json")
    with open(fpath, "w") as f:
        json.dump({**data, "id": cid}, f, indent=2, ensure_ascii=False)
    return {"status": "saved", "id": cid}

@router.get("/api/leads")
async def get_leads():
    if os.path.exists(str(LEADS_FILE)):
        with open(str(LEADS_FILE)) as f:
            data = json.load(f)
            return {"leads": data.get("leads", [])}
    return {"leads": []}

@router.post("/api/leads")
async def save_leads(data: dict = Body(...)):
    os.makedirs(os.path.dirname(str(LEADS_FILE)), exist_ok=True)
    with open(str(LEADS_FILE), "w") as f:
        json.dump({"leads": data.get("leads", [])}, f, indent=2, ensure_ascii=False)
    return {"status": "saved"}

@router.post("/api/knowledge/query")
async def knowledge_query(data: dict = Body(...)):
    from kb import query_knowledge, format_kb_results
    q = data.get("query", "")
    project = data.get("project", "")
    top_k = data.get("top_k", 5)
    if not q:
        raise HTTPException(400, "query is required")
    results = query_knowledge(project=project or None, query=q, top_k=top_k)
    formatted = format_kb_results(results, q)
    return {"results": results, "formatted": formatted, "count": len(results)}

@router.post("/api/knowledge/reindex")
async def knowledge_reindex(data: dict = Body({})):
    from kb import reindex_project, _get_current_project
    project = data.get("project", "")
    p = project or _get_current_project()
    result = reindex_project(p)
    return result

@router.get("/api/knowledge/stats")
async def knowledge_stats(project: str = ""):
    from kb import get_collection_stats, _get_current_project
    p = project or _get_current_project()
    return get_collection_stats(p)

@router.delete("/api/knowledge/{project}")
async def knowledge_delete_collection(project: str):
    from kb import delete_collection
    ok = delete_collection(project)
    return {"status": "deleted" if ok else "not_found"}
