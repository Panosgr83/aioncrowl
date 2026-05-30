import json, os, time
from datetime import datetime
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.interval import IntervalTrigger

AION_DIR = os.path.expanduser("~/AION")
JOBS_FILE = os.path.join(AION_DIR, "MEMORY", "scheduled_jobs.json")

_scheduler = None

def _get_scheduler():
    global _scheduler
    if _scheduler is None:
        _scheduler = BackgroundScheduler()
    return _scheduler

def _load_jobs():
    try:
        if os.path.exists(JOBS_FILE):
            with open(JOBS_FILE) as f:
                return json.load(f)
    except:
        pass
    return []

def _save_jobs(jobs):
    os.makedirs(os.path.dirname(JOBS_FILE), exist_ok=True)
    with open(JOBS_FILE, "w") as f:
        json.dump(jobs, f, indent=2, ensure_ascii=False)

def get_jobs():
    return _load_jobs()

def add_job(name, agent_id, task, interval_minutes=60, project="default"):
    jobs = _load_jobs()
    jid = str(int(datetime.now().timestamp() * 1000))
    job = {
        "id": jid,
        "name": name,
        "agent_id": agent_id,
        "task": str(task)[:1000],
        "interval_minutes": interval_minutes,
        "project": project,
        "enabled": True,
        "created": datetime.now().isoformat(),
        "last_run": None,
        "run_count": 0,
    }
    jobs.append(job)
    _save_jobs(jobs)
    _schedule_job(job)
    return job

def delete_job(job_id):
    jobs = _load_jobs()
    jobs = [j for j in jobs if j["id"] != job_id]
    _save_jobs(jobs)
    try:
        _get_scheduler().remove_job(job_id)
    except:
        pass
    return True

def toggle_job(job_id):
    jobs = _load_jobs()
    for j in jobs:
        if j["id"] == job_id:
            j["enabled"] = not j["enabled"]
            if j["enabled"]:
                _schedule_job(j)
            else:
                try:
                    _get_scheduler().remove_job(j["id"])
                except:
                    pass
            break
    _save_jobs(jobs)
    return True

def run_job_now(job_id):
    jobs = _load_jobs()
    for j in jobs:
        if j["id"] == job_id:
            _execute_job(j)
            return True
    return False

def _execute_job(job):
    from collaboration import bus, run_sub_agent
    aid = job["agent_id"]
    task = f"⏰ Προγραμματισμένη εργασία: {job['name']}\n\n{job['task']}"
    bus.log("scheduler", aid, "scheduled_job", f"Εκτέλεση: {job['name']}")
    try:
        result = run_sub_agent(aid, task)
        jobs = _load_jobs()
        for j in jobs:
            if j["id"] == job["id"]:
                j["last_run"] = datetime.now().isoformat()
                j["run_count"] = j.get("run_count", 0) + 1
        _save_jobs(jobs)
        bus.log(aid, "scheduler", "scheduled_result", f"Ολοκλήρωση: {job['name']} ({len(result)} chars)")
    except Exception as e:
        bus.log("scheduler", "error", "scheduled_error", f"{job['name']}: {str(e)[:200]}")

def _schedule_job(job):
    if not job.get("enabled", True):
        return
    minutes = max(1, job.get("interval_minutes", 60))
    _get_scheduler().add_job(
        func=_execute_job,
        trigger=IntervalTrigger(minutes=minutes),
        args=[job],
        id=job["id"],
        name=job["name"],
        replace_existing=True,
    )

def start_scheduler():
    sched = _get_scheduler()
    jobs = _load_jobs()
    for job in jobs:
        if job.get("enabled", True):
            try:
                _schedule_job(job)
            except:
                pass
    if not sched.running:
        sched.start()
    return True
