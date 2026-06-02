import json, os
from fastapi import APIRouter, HTTPException, Body
from config import PROJECT_FILE
from shared import _load_project, _save_project

router = APIRouter(tags=["projects"])

@router.get("/api/projects")
async def list_projects():
    pdata = _load_project()
    projects = pdata.get("projects", [])
    if not projects:
        projects_dir = os.path.join(os.path.dirname(str(PROJECT_FILE)), "sessions")
        if os.path.exists(projects_dir):
            projects = [d for d in os.listdir(projects_dir) if os.path.isdir(os.path.join(projects_dir, d))]
    return {"projects": projects, "current": pdata.get("current", "default")}

@router.post("/api/projects/set")
async def set_project(data: dict):
    name = data.get("project", "default")
    pdata = _load_project()
    projects = pdata.get("projects", [])
    if name not in projects:
        projects.append(name)
    pdata["projects"] = projects
    pdata["current"] = name
    _save_project(pdata)
    return {"status": "ok", "current": name}

@router.post("/api/projects/delete")
async def delete_project(data: dict):
    name = data.get("project", "")
    pdata = _load_project()
    projects = pdata.get("projects", [])
    if name in projects:
        projects.remove(name)
        if pdata.get("current") == name:
            pdata["current"] = projects[0] if projects else "default"
    pdata["projects"] = projects
    _save_project(pdata)
    return {"status": "deleted"}

@router.get("/api/project")
async def get_project():
    return _load_project()

@router.post("/api/project")
async def set_project_(data: dict = Body(...)):
    name = data.get("name", "default").strip()
    if not name: name = "default"
    safe = name.lower().replace(" ", "_").replace("/", "_")
    pdata = _load_project()
    pdata["current"] = safe
    if safe not in pdata["projects"]:
        pdata["projects"].append(safe)
    _save_project(pdata)

    from config import SESSIONS_DIR
    SESSION_DIR = str(SESSIONS_DIR)
    if safe != "default":
        pdir = os.path.join(SESSION_DIR, safe)
        os.makedirs(pdir, exist_ok=True)
        import shutil
        for fname in os.listdir(SESSION_DIR):
            if fname.endswith(".json") and os.path.isfile(os.path.join(SESSION_DIR, fname)):
                src = os.path.join(SESSION_DIR, fname)
                dst = os.path.join(pdir, fname)
                if not os.path.exists(dst):
                    shutil.copy2(src, dst)
    defdir = os.path.join(SESSION_DIR, "default")
    os.makedirs(defdir, exist_ok=True)
    for fname in os.listdir(SESSION_DIR):
        if fname.endswith(".json") and os.path.isfile(os.path.join(SESSION_DIR, fname)):
            src = os.path.join(SESSION_DIR, fname)
            dst = os.path.join(defdir, fname)
            if not os.path.exists(dst):
                import shutil
                shutil.copy2(src, dst)
        elif os.path.isdir(os.path.join(SESSION_DIR, fname)) and fname != "default" and fname != safe:
            pdir = os.path.join(SESSION_DIR, fname)
            for sf in os.listdir(pdir):
                if sf.endswith(".json"):
                    src = os.path.join(pdir, sf)
                    dst = os.path.join(defdir, sf)
                    if not os.path.exists(dst):
                        shutil.copy2(src, dst)
    return pdata

@router.delete("/api/project/{name}")
async def delete_project_(name: str):
    safe = name.lower().replace(" ", "_").replace("/", "_")
    if safe == "default":
        return {"ok": False, "error": "Cannot delete default project"}
    pdata = _load_project()
    if safe in pdata["projects"]:
        pdata["projects"].remove(safe)
        if pdata.get("current") == safe:
            pdata["current"] = "default"
        _save_project(pdata)
    from config import SESSIONS_DIR
    pdir = os.path.join(str(SESSIONS_DIR), safe)
    if os.path.exists(pdir):
        import shutil
        shutil.rmtree(pdir)
    return {"ok": True}
