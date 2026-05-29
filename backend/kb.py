import json, os, hashlib, time, threading
import numpy as np
from datetime import datetime

AION_DIR = os.path.expanduser("~/AION")
KB_ROOT = os.path.join(AION_DIR, "aionclaw", "knowledge")
PROJECT_FILE = os.path.join(AION_DIR, "MEMORY", "project.json")

_model = None
_model_lock = threading.Lock()
_kb_lock = threading.Lock()

def _get_current_project():
    try:
        if os.path.exists(PROJECT_FILE):
            with open(PROJECT_FILE) as f:
                return json.load(f).get("current", "default")
    except:
        pass
    return "default"

def _collection_name(project):
    safe = project.lower().replace(" ", "_").replace("/", "_").replace("-", "_")
    return safe

def _get_project_dir(project):
    return os.path.join(KB_ROOT, _collection_name(project))

def _get_model():
    global _model
    if _model is None:
        with _model_lock:
            if _model is None:
                from sentence_transformers import SentenceTransformer
                _model = SentenceTransformer("all-MiniLM-L6-v2")
    return _model

def _embed(texts):
    model = _get_model()
    vecs = model.encode(texts, show_progress_bar=False, normalize_embeddings=True)
    return np.asarray(vecs, dtype=np.float32)

def _load_kb(project):
    d = _get_project_dir(project)
    os.makedirs(d, exist_ok=True)
    vpath = os.path.join(d, "vectors.npy")
    mpath = os.path.join(d, "metadata.json")
    vectors = np.load(vpath) if os.path.exists(vpath) else np.empty((0, 384), dtype=np.float32)
    if os.path.exists(mpath):
        with open(mpath) as f:
            metadata = json.load(f)
    else:
        metadata = []
    return vectors, metadata

def _save_kb(project, vectors, metadata):
    d = _get_project_dir(project)
    os.makedirs(d, exist_ok=True)
    np.save(os.path.join(d, "vectors.npy"), vectors)
    with open(os.path.join(d, "metadata.json"), "w") as f:
        json.dump(metadata, f, indent=2, ensure_ascii=False)

def init_kb(project):
    for p in [project, "global_kb"]:
        d = _get_project_dir(p)
        os.makedirs(d, exist_ok=True)
        vp = os.path.join(d, "vectors.npy")
        mp = os.path.join(d, "metadata.json")
        if not os.path.exists(vp):
            np.save(vp, np.empty((0, 384), dtype=np.float32))
        if not os.path.exists(mp):
            with open(mp, "w") as f:
                json.dump([], f)
    return True

def _chunk_text(text, chunk_size=500, overlap=50):
    if not text:
        return []
    if len(text) <= chunk_size:
        return [text]
    chunks = []
    start = 0
    while start < len(text):
        end = start + chunk_size
        if end >= len(text):
            chunks.append(text[start:])
            break
        bp = text.rfind("\n", start, end)
        if bp <= start:
            bp = text.rfind(" ", start, end)
            if bp <= start:
                bp = end
        chunks.append(text[start:bp])
        start = bp - overlap
    return chunks

def index_file(project, filepath, agent_id=None):
    if not os.path.exists(filepath):
        return False, f"File not found: {filepath}"
    try:
        with open(filepath, "r", encoding="utf-8", errors="replace") as f:
            text = f.read()
    except:
        return False, "Cannot read file"
    if not text.strip():
        return False, "Empty file"
    filename = os.path.basename(filepath)
    chunks = _chunk_text(text)
    vectors_to_add = _embed(chunks)
    metadata_to_add = []
    for i, chunk in enumerate(chunks):
        metadata_to_add.append({
            "text": chunk,
            "source": filename,
            "path": filepath,
            "type": "file",
            "agent_id": agent_id or "",
            "project": project,
            "timestamp": datetime.now().isoformat(),
        })
    with _kb_lock:
        vectors, metadata = _load_kb(project)
        vectors = np.concatenate([vectors, vectors_to_add], axis=0) if len(vectors) > 0 else vectors_to_add
        metadata.extend(metadata_to_add)
        _save_kb(project, vectors, metadata)
    return True, f"Indexed {len(chunks)} chunks from {filename}"

def index_text(project, text, metadata=None):
    if not text.strip():
        return False, "Empty text"
    chunks = _chunk_text(text)
    vectors_to_add = _embed(chunks)
    meta_base = metadata or {}
    metadata_to_add = []
    ts = datetime.now().isoformat()
    for i, chunk in enumerate(chunks):
        m = dict(meta_base)
        m.update({"text": chunk, "type": "text", "project": project, "timestamp": ts})
        metadata_to_add.append(m)
    with _kb_lock:
        vectors, meta_list = _load_kb(project)
        vectors = np.concatenate([vectors, vectors_to_add], axis=0) if len(vectors) > 0 else vectors_to_add
        meta_list.extend(metadata_to_add)
        _save_kb(project, vectors, meta_list)
    return True, f"Indexed {len(chunks)} chunks"

def query_knowledge(project=None, query="", top_k=5):
    if not project:
        project = _get_current_project()
    if not query:
        return []
    init_kb(project)
    init_kb("global_kb")
    qvec = _embed([query])[0]
    results = []
    for pname, limit in [(project, min(top_k, 3)), ("global_kb", max(0, top_k - 3))]:
        if limit <= 0:
            continue
        try:
            vectors, metadata = _load_kb(pname)
            if len(vectors) == 0:
                continue
            scores = np.dot(vectors, qvec)
            top_indices = np.argsort(scores)[::-1][:limit]
            for idx in top_indices:
                score = float(scores[idx])
                if score < 0.1:
                    continue
                meta = metadata[idx] if idx < len(metadata) else {}
                results.append({
                    "content": meta.get("text", ""),
                    "metadata": meta,
                    "collection": pname,
                    "distance": 1.0 - score,
                    "score": score,
                })
        except:
            pass
    results.sort(key=lambda r: r["score"], reverse=True)
    return results[:top_k]

def format_kb_results(results, query=""):
    if not results:
        return "Δεν βρέθηκαν αποτελέσματα στο Knowledge Base."
    lines = [f"## Knowledge Base Results{' για: ' + query if query else ''}", ""]
    for i, r in enumerate(results, 1):
        src = r["metadata"].get("source", r["metadata"].get("path", "άγνωστη πηγή"))
        coll = r["collection"]
        dist = r.get("distance", 0)
        score = r.get("score", 0)
        label = "🌐 project" if coll != "global_kb" else "📦 global"
        lines.append(f"### {i}. {src} [{label}]")
        lines.append(f"```\n{r['content'][:400]}\n```")
        lines.append(f"  _Συλλογή: {coll}, relevance: {score:.3f}_")
        lines.append("")
    return "\n".join(lines)

def reindex_project(project):
    pdir = _get_project_dir(project)
    fdir = os.path.join(pdir, "files")
    if not os.path.exists(fdir):
        return {"status": "ok", "count": 0, "message": "No files directory"}
    count = 0
    for root, dirs, files in os.walk(fdir):
        for fname in files:
            fpath = os.path.join(root, fname)
            ok, msg = index_file(project, fpath)
            if ok:
                count += 1
    return {"status": "ok", "count": count, "message": f"Reindexed {count} files"}

def delete_collection(project):
    pdir = _get_project_dir(project)
    vp = os.path.join(pdir, "vectors.npy")
    mp = os.path.join(pdir, "metadata.json")
    for f in [vp, mp]:
        if os.path.exists(f):
            os.remove(f)
    return True

def get_collection_stats(project=None):
    if not project:
        project = _get_current_project()
    init_kb(project)
    init_kb("global_kb")
    stats = {"project": project, "project_chunks": 0, "global_chunks": 0, "sources": []}
    sources_set = set()
    try:
        _, metadata = _load_kb(project)
        stats["project_chunks"] = len(metadata)
        for m in metadata:
            if m.get("source"):
                sources_set.add(m["source"])
            elif m.get("path"):
                sources_set.add(os.path.basename(m["path"]))
    except:
        pass
    try:
        _, gmeta = _load_kb("global_kb")
        stats["global_chunks"] = len(gmeta)
    except:
        pass
    stats["sources"] = sorted(sources_set)
    return stats
