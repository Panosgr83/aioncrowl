import json, os, traceback, tempfile, shutil, re
from pathlib import Path
from fastapi import APIRouter, HTTPException, UploadFile, File, Form, Body
from fastapi.responses import FileResponse, Response
from config import UPLOADS_DIR, KB_ROOT, CRM_DIR, LEADS_FILE
from shared import UPLOAD_DIR, get_agent_file_names as get_file_names

router = APIRouter(tags=["files"])

@router.get("/api/files/{agent_id}")
async def list_files(agent_id: str):
    dir_path = os.path.join(str(UPLOAD_DIR), agent_id)
    files = []
    if os.path.exists(dir_path):
        for fname in os.listdir(dir_path):
            fpath = os.path.join(dir_path, fname)
            if os.path.isfile(fpath):
                files.append({
                    "name": fname,
                    "size": os.path.getsize(fpath),
                    "modified": int(os.path.getmtime(fpath)),
                })
    return {"files": files}

@router.post("/api/upload")
async def upload_file(agent_id: str = Form("ceo"), file: UploadFile = File(...)):
    upload_dir = os.path.join(str(UPLOAD_DIR), agent_id)
    os.makedirs(upload_dir, exist_ok=True)
    file_path = os.path.join(upload_dir, file.filename)
    try:
        content = await file.read()
        with open(file_path, "wb") as f:
            f.write(content)
        return {"status": "ok", "filename": file.filename, "size": len(content)}
    except Exception as e:
        raise HTTPException(400, f"Upload failed: {e}")

@router.delete("/api/files/{agent_id}/{filename}")
async def delete_file(agent_id: str, filename: str):
    fpath = os.path.join(str(UPLOAD_DIR), agent_id, filename)
    fpath = os.path.normpath(fpath)
    if not fpath.startswith(str(UPLOAD_DIR)):
        raise HTTPException(400, "Invalid path")
    if os.path.exists(fpath):
        os.remove(fpath)
        return {"status": "deleted"}
    raise HTTPException(404, "File not found")

@router.get("/api/files/content/{agent_id}/{filename:path}")
async def get_file_content(agent_id: str, filename: str):
    fpath = os.path.join(str(UPLOAD_DIR), agent_id, filename)
    fpath = os.path.normpath(fpath)
    if not fpath.startswith(str(UPLOAD_DIR)):
        raise HTTPException(400, "Invalid path")
    if not os.path.exists(fpath):
        raise HTTPException(404, "File not found")
    ext = os.path.splitext(filename)[1].lower()
    text_exts = {".txt", ".md", ".json", ".csv", ".xml", ".yml", ".yaml", ".py", ".js", ".ts", ".html", ".css", ".sh", ".env", ".cfg", ".ini"}
    if ext in text_exts:
        with open(fpath) as f:
            return {"content": f.read(), "type": "text"}
    return {"content": "[Binary file]", "type": "binary"}

@router.get("/api/file-names/{agent_id}")
async def get_agent_file_names(agent_id: str):
    return {"files": get_file_names(agent_id)}

@router.get("/api/files")
async def list_all_files(path: str = ""):
    from config import AION_DIR
    from datetime import datetime
    base = os.path.expanduser(path) if path else AION_DIR
    if not os.path.isdir(base):
        raise HTTPException(400, f"Not a directory: {base}")
    items = []
    for name in sorted(os.listdir(base)):
        full = os.path.join(base, name)
        try:
            stat = os.stat(full)
            items.append({
                "name": name,
                "path": full,
                "is_dir": os.path.isdir(full),
                "size": stat.st_size,
                "modified": datetime.fromtimestamp(stat.st_mtime).isoformat(),
            })
        except:
            pass
    return {"path": base, "items": items, "parent": os.path.dirname(base) if base != "/" else None}

@router.get("/api/files/read")
async def read_file(path: str):
    full = os.path.expanduser(path)
    if not os.path.isfile(full):
        raise HTTPException(400, f"File not found: {full}")
    if os.path.getsize(full) > 1024 * 1024:
        raise HTTPException(400, "File too large (>1MB)")
    try:
        with open(full) as f:
            content = f.read()
        return {"path": full, "content": content, "size": len(content)}
    except Exception as e:
        raise HTTPException(400, f"Read error: {e}")

@router.get("/api/files/download")
async def download_file(path: str):
    full = os.path.expanduser(path)
    if not os.path.isfile(full):
        raise HTTPException(400, f"File not found: {full}")
    return FileResponse(full, filename=os.path.basename(full))

@router.get("/api/files/zip")
async def zip_files(path: str = None):
    import shutil, io, zipfile
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as zf:
        if path:
            base = os.path.expanduser(path)
            if os.path.isfile(base):
                zf.write(base, os.path.basename(base))
            elif os.path.isdir(base):
                for root, _dirs, files in os.walk(base):
                    for f in files:
                        fpath = os.path.join(root, f)
                        arcname = os.path.relpath(fpath, os.path.dirname(base))
                        zf.write(fpath, arcname)
        else:
            if os.path.isdir(str(UPLOAD_DIR)):
                for root, _dirs, files in os.walk(str(UPLOAD_DIR)):
                    for f in files:
                        fpath = os.path.join(root, f)
                        arcname = os.path.relpath(fpath, os.path.dirname(str(UPLOAD_DIR)))
                        zf.write(fpath, arcname)
    buf.seek(0)
    return Response(buf.getvalue(), media_type="application/zip",
                    headers={"Content-Disposition": f"attachment; filename=aionclaw_files.zip"})

@router.post("/api/files/upload")
async def upload_file_general(agent_id: str = Form("ceo"), file: UploadFile = File(None)):
    if not file:
        raise HTTPException(400, "No file provided")
    upload_dir = os.path.join(str(UPLOAD_DIR), agent_id)
    os.makedirs(upload_dir, exist_ok=True)
    fpath = os.path.join(upload_dir, file.filename)
    content = await file.read()
    with open(fpath, "wb") as f:
        f.write(content)
    from collaboration import bus
    bus.broadcast({"type": "file_updated", "agent_id": agent_id, "filename": file.filename})
    return {"status": "ok", "filename": file.filename, "size": len(content), "path": fpath}

@router.get("/api/project/files")
async def project_files():
    from datetime import datetime
    files = []
    if os.path.isdir(str(UPLOAD_DIR)):
        for root, _dirs, fnames in os.walk(str(UPLOAD_DIR)):
            for f in fnames:
                fpath = os.path.join(root, f)
                rel = os.path.relpath(fpath, str(UPLOAD_DIR))
                agent = os.path.basename(os.path.dirname(fpath))
                files.append({
                    "name": f, "path": fpath, "agent": agent,
                    "size": os.path.getsize(fpath),
                    "modified": datetime.fromtimestamp(os.path.getmtime(fpath)).isoformat()
                })
    return {"files": files}

@router.post("/api/agents/{agent_id}/upload")
async def upload_agent_file(agent_id: str, file: UploadFile = File(...)):
    dir_path = os.path.join(str(UPLOAD_DIR), agent_id)
    os.makedirs(dir_path, exist_ok=True)
    content = await file.read()
    file_path = os.path.join(dir_path, file.filename)
    with open(file_path, "wb") as f:
        f.write(content)
    TEXT_EXT = {".txt", ".md", ".json", ".py", ".js", ".ts", ".jsx", ".tsx", ".html", ".css", ".csv", ".yml", ".yaml", ".xml", ".ini", ".cfg", ".env"}
    ext = os.path.splitext(file.filename)[1].lower()
    if ext in TEXT_EXT:
        try:
            from kb import index_file, _get_current_project
            project = _get_current_project()
            index_file(project, file_path, agent_id)
        except Exception as e:
            print(f"KB auto-index error: {e}")
    print(f"Uploaded: {file_path} ({len(content)} bytes)")
    return {"status": "uploaded", "filename": file.filename, "path": file_path, "size": len(content), "indexed": ext in TEXT_EXT}

@router.get("/api/agents/{agent_id}/files")
async def list_agent_files(agent_id: str):
    from datetime import datetime
    files = []
    dir_path = os.path.join(str(UPLOAD_DIR), agent_id)
    if os.path.exists(dir_path):
        for name in sorted(os.listdir(dir_path)):
            full = os.path.join(dir_path, name)
            try:
                files.append({
                    "name": name,
                    "size": os.path.getsize(full),
                    "modified": datetime.fromtimestamp(os.path.getmtime(full)).isoformat(),
                    "source": agent_id,
                    "path": full,
                })
            except:
                pass
    if agent_id != "ceo":
        ceo_path = os.path.join(str(UPLOAD_DIR), "ceo")
        if os.path.exists(ceo_path):
            for name in sorted(os.listdir(ceo_path)):
                full = os.path.join(ceo_path, name)
                if not any(f["name"] == name for f in files):
                    try:
                        files.append({
                            "name": name,
                            "size": os.path.getsize(full),
                            "modified": datetime.fromtimestamp(os.path.getmtime(full)).isoformat(),
                            "source": "ceo (shared)",
                            "path": full,
                        })
                    except:
                        pass
    return {"files": files, "agent_id": agent_id}

@router.delete("/api/agents/{agent_id}/files/{filename}")
async def delete_agent_file(agent_id: str, filename: str):
    file_path = os.path.join(str(UPLOAD_DIR), agent_id, filename)
    if os.path.exists(file_path):
        os.remove(file_path)
        return {"status": "deleted", "filename": filename}
    raise HTTPException(404, "File not found")
