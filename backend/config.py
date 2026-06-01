import os
from pathlib import Path

BASE_DIR = Path(os.environ.get("AION_BASE_PATH", os.path.expanduser("~/AION")))

# Core directories
AION_DIR = BASE_DIR
MEMORY_DIR = AION_DIR / "MEMORY"
SESSIONS_DIR = AION_DIR / "aionclaw" / "sessions"
UPLOADS_DIR = AION_DIR / "aionclaw" / "uploads"
KB_ROOT = AION_DIR / "aionclaw" / "knowledge"
CRM_DIR = AION_DIR / "AION_CONNECT_CRM"

# Files
MEMORY_FILE = MEMORY_DIR / "memory.json"
ACTIVITY_FILE = MEMORY_DIR / "activity.jsonl"
PERF_FILE = MEMORY_DIR / "engine_perf.json"
PROJECT_FILE = MEMORY_DIR / "project.json"
COLLAB_LOG = MEMORY_DIR / "collab_log.json"
ENGINE_STATUS_FILE = AION_DIR / "engine_status.json"
READS_FILE = MEMORY_DIR / "reads.json"
SCHEDULED_JOBS_FILE = MEMORY_DIR / "scheduled_jobs.json"
PERFORMANCE_FILE = MEMORY_DIR / "performance.json"
LEADS_FILE = CRM_DIR / "leads" / "leads-database.json"
DOTENV_FILE = AION_DIR / ".env"

# Sync
def init():
    MEMORY_DIR.mkdir(parents=True, exist_ok=True)
    SESSIONS_DIR.mkdir(parents=True, exist_ok=True)
    UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
    KB_ROOT.mkdir(parents=True, exist_ok=True)
    (CRM_DIR / "leads").mkdir(parents=True, exist_ok=True)
