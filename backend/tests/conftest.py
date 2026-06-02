"""Shared fixtures for tests."""
import pytest, os, sys, json, tempfile

os.environ["PORT"] = "9799"


@pytest.fixture(autouse=True)
def no_auto_save(monkeypatch, tmp_path):
    """Prevent tests from writing to real project/session files."""
    test_dir = tmp_path / "aion_test"
    test_dir.mkdir()
    monkeypatch.setattr("config.AION_DIR", test_dir)
    monkeypatch.setattr("config.MEMORY_DIR", test_dir / "memory")
    monkeypatch.setattr("config.SESSIONS_DIR", test_dir / "sessions")
    monkeypatch.setattr("config.UPLOADS_DIR", test_dir / "uploads")
    monkeypatch.setattr("config.PROJECT_FILE", test_dir / "project.json")
    monkeypatch.setattr("config.COLLAB_LOG", test_dir / "collab_log.json")
    monkeypatch.setattr("config.PERF_FILE", test_dir / "engine_perf.json")
    for d in [test_dir / "memory", test_dir / "sessions", test_dir / "uploads"]:
        d.mkdir(parents=True, exist_ok=True)
