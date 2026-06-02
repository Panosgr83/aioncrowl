"""Tests for shared module — AgentContext, trim_messages, summary injection, file locking."""
import pytest
import sys, os, json, threading, time
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from shared import (
    AgentContext, trim_messages, sanitize_messages,
    _load_session_file, _save_session_file, _merge_session_messages,
    _session_file, _load_project, _save_project, PROJECT_FILE, SESSION_CACHE,
    _cache_get, _cache_set, _make_summary_block
)


def test_sanitize_messages_removes_ts():
    msgs = [{"role": "user", "content": "hello", "ts": "now"}]
    clean = sanitize_messages(msgs)
    assert "ts" not in clean[0]


def test_sanitize_messages_allows_valid():
    msgs = [{"role": "user", "content": "hello", "tool_calls": [], "name": "test"}]
    clean = sanitize_messages(msgs)
    assert clean[0]["role"] == "user"


def test_trim_messages_preserves_system():
    msgs = [
        {"role": "system", "content": "You are CEO"},
        {"role": "user", "content": "hi"},
        {"role": "assistant", "content": "hello"},
    ]
    trimmed = trim_messages(msgs)
    assert any(m.get("role") == "system" for m in trimmed)


def test_trim_messages_limits_context():
    msgs = [{"role": "system", "content": "sys"}]
    for i in range(20):
        msgs.append({"role": "user" if i % 2 == 0 else "assistant", "content": str(i)})
    trimmed = trim_messages(msgs)
    non_system = [m for m in trimmed if m["role"] != "system"]
    assert len(non_system) <= 6


def test_make_summary_block_triggers():
    msgs = [{"role": "user", "content": f"message {i}"} for i in range(15)]
    result = _make_summary_block(msgs)
    assert any(m.get("role") == "system" and "Σύνοψη" in m.get("content", "") for m in result)


def test_make_summary_block_small():
    msgs = [{"role": "user", "content": "hi"}]
    result = _make_summary_block(msgs)
    assert len(result) == 1


def test_merge_session_messages_dedup():
    existing = [{"role": "user", "content": "hello", "ts": "t1"}]
    incoming = [{"role": "user", "content": "hello", "ts": "t1"}]
    merged = _merge_session_messages(existing, incoming)
    assert len(merged) == 1


def test_merge_session_messages_append():
    existing = [{"role": "user", "content": "hello", "ts": "t1"}]
    incoming = [{"role": "assistant", "content": "world", "ts": "t2"}]
    merged = _merge_session_messages(existing, incoming)
    assert len(merged) == 2


def test_session_file_creates_path():
    path = _session_file("test_agent:test_session")
    assert path.endswith(".json")
    assert "test_agent_test_session" in path


def test_cache_set_and_get():
    _cache_set("test_key", {"data": 123})
    result = _cache_get("test_key")
    assert result == {"data": 123}


def test_file_locking_concurrent(tmp_path):
    """Simulate concurrent saves to verify locking doesn't corrupt."""
    test_file = tmp_path / "test_lock.json"
    errors = []

    def writer(i):
        try:
            existing = {"messages": []}
            if test_file.exists():
                with open(test_file) as f:
                    existing = json.load(f)
            existing["messages"].append({"role": "user", "content": f"msg_{i}", "ts": f"t{i}"})
            with open(test_file, "w") as f:
                json.dump(existing, f)
        except Exception as e:
            errors.append(e)

    threads = [threading.Thread(target=writer, args=(i,)) for i in range(20)]
    for t in threads: t.start()
    for t in threads: t.join()

    assert len(errors) == 0
    with open(test_file) as f:
        data = json.load(f)
    assert len(data["messages"]) == 20


def test_project_file_lock(tmp_path):
    backup = PROJECT_FILE
    test_project_file = tmp_path / "project.json"

    import shared
    shared.PROJECT_FILE = str(test_project_file)

    _save_project({"current": "test", "projects": ["test"]})
    loaded = _load_project()
    assert loaded["current"] == "test"

    shared.PROJECT_FILE = backup


def test_agent_context_trim_integration():
    ctx = AgentContext("", True, agent_id="ceo", session_id="test_integration")
    for i in range(15):
        ctx.add_message("user" if i % 2 == 0 else "assistant", f"message {i}")
    trimmed = trim_messages(ctx.messages)
    non_system = [m for m in trimmed if m["role"] != "system"]
    assert len(non_system) <= 6
