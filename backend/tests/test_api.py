"""Tests for API endpoints using TestClient."""
import pytest
import sys, os, json
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

os.environ["PORT"] = "9799"

from fastapi.testclient import TestClient
from main import app

client = TestClient(app)


def test_health_endpoint():
    resp = client.get("/api/health")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "ok"
    assert "uptime" in data
    assert "active_sessions" in data
    assert "active_engines" in data


def test_agents_endpoint():
    resp = client.get("/api/agents")
    assert resp.status_code == 200
    data = resp.json()
    assert "agents" in data
    assert len(data["agents"]) >= 15


def test_engines_endpoint():
    resp = client.get("/api/engines")
    assert resp.status_code == 200
    data = resp.json()
    assert "engines" in data
    assert len(data["engines"]) >= 1


def test_sessions_list():
    resp = client.get("/api/sessions")
    assert resp.status_code == 200
    data = resp.json()
    assert "sessions" in data


def test_projects_list():
    resp = client.get("/api/projects")
    assert resp.status_code == 200
    data = resp.json()
    assert "projects" in data
    assert "current" in data


def test_project_get():
    resp = client.get("/api/project")
    assert resp.status_code == 200
    data = resp.json()
    assert "current" in data


def test_project_set_and_delete():
    resp = client.post("/api/project", json={"name": "test_project"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["current"] == "test_project"

    resp = client.delete("/api/project/test_project")
    assert resp.status_code == 200


def test_engine_perf():
    resp = client.get("/api/engine-perf")
    assert resp.status_code == 200
    data = resp.json()
    assert "stats" in data


def test_agent_heartbeat():
    resp = client.get("/api/agent-heartbeat")
    assert resp.status_code == 200
    data = resp.json()
    assert "last_seen" in data


def test_comm_log():
    resp = client.get("/api/comm-log")
    assert resp.status_code == 200
    data = resp.json()
    assert "entries" in data


def test_performance():
    resp = client.get("/api/performance")
    assert resp.status_code == 200


def test_activity():
    resp = client.get("/api/activity")
    assert resp.status_code == 200
    data = resp.json()
    assert "entries" in data


def test_scheduler_jobs():
    resp = client.get("/api/scheduler/jobs")
    assert resp.status_code == 200
    data = resp.json()
    assert "jobs" in data


def test_auto_status():
    resp = client.get("/api/auto/status")
    assert resp.status_code == 200
    data = resp.json()
    assert "active" in data or "projects" in data or "enabled" in data


def test_collab_history():
    resp = client.get("/api/collab/history")
    assert resp.status_code == 200


def test_collab_reads():
    resp = client.get("/api/collab/reads")
    assert resp.status_code == 200
