import json
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException, Body, Query
from pydantic import BaseModel
from scheduler import add_cron_job, add_job, get_jobs, delete_job, toggle_job, run_job_now

router = APIRouter(tags=["scheduler"])

@router.get("/api/scheduler/jobs")
async def list_jobs():
    jobs_data = get_jobs()
    return {"jobs": jobs_data}

class SchedulerAdd(BaseModel):
    name: str
    agent_id: str
    task: str
    interval_minutes: int = 60
    project: str = ""

class SchedulerCronAdd(BaseModel):
    name: str
    agent_id: str
    task: str
    cron: str
    project: str = ""

@router.post("/api/scheduler/add")
async def scheduler_add(data: SchedulerAdd):
    from kb import _get_current_project
    project = data.project or _get_current_project()
    job = add_job(data.name, data.agent_id, data.task, data.interval_minutes, project)
    return {"status": "added", "job": job}

@router.post("/api/scheduler/cron")
async def scheduler_cron(data: SchedulerCronAdd):
    from kb import _get_current_project
    project = data.project or _get_current_project()
    job = add_cron_job(data.name, data.agent_id, data.task, data.cron, project)
    return {"status": "added", "job": job}

@router.delete("/api/scheduler/{job_id}")
async def scheduler_delete(job_id: str):
    delete_job(job_id)
    return {"status": "deleted"}

@router.post("/api/scheduler/{job_id}/toggle")
async def scheduler_toggle(job_id: str):
    toggle_job(job_id)
    return {"status": "toggled"}

@router.post("/api/scheduler/{job_id}/run")
async def scheduler_run(job_id: str):
    ok = run_job_now(job_id)
    return {"status": "executed" if ok else "not_found"}

@router.get("/api/auto/status")
async def auto_status():
    try:
        from telegram_bot import _auto_active, available_projects
        return {"active": _auto_active, "projects": available_projects()}
    except:
        return {"active": False}

@router.post("/api/auto/toggle")
async def auto_toggle(data: dict = Body(...)):
    try:
        from telegram_bot import start_auto, stop_auto
        active = data.get("active", False)
        interval = data.get("interval", 120)
        if active:
            start_auto(max(15, interval))
            return {"status": "started", "interval": interval}
        else:
            stop_auto()
            return {"status": "stopped"}
    except Exception as e:
        return {"status": "error", "error": str(e)}
