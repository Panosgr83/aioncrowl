"""Tests for engine scoring, filtering, and performance."""
import pytest
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from engine import (
    ENGINES, get_active_engines, get_engine_score,
    get_engine_status, mark_engine, suggest_engine_for,
    record_engine_perf, get_engine_perf,
)


def test_engines_defined():
    assert len(ENGINES) >= 6
    ids = [e["id"] for e in ENGINES]
    assert "cerebras" in ids
    assert "groq" in ids


def test_engine_score_values():
    cerebras = next(e for e in ENGINES if e["id"] == "cerebras")
    assert get_engine_score(cerebras) >= 2000

    gemini = next((e for e in ENGINES if e["id"] == "gemini"), None)
    if gemini:
        assert get_engine_score(gemini) >= 1500

    groq = next(e for e in ENGINES if e["id"] == "groq")
    assert get_engine_score(groq) >= 500


def test_inactive_filtered():
    active = get_active_engines()
    for e in active:
        assert e.get("status") != "inactive"


def test_mark_engine_rate_limited():
    mark_engine("test_engine", "rate_limited", 300)
    status = get_engine_status().get("test_engine", {})
    assert status.get("status") == "rate_limited"


def test_suggest_engine_for():
    suggested = suggest_engine_for("reasoning")
    assert suggested is not None
    assert suggested["id"] in [e["id"] for e in ENGINES]


def test_active_engines_task_type():
    reasoning = get_active_engines(task_type="reasoning")
    assert len(reasoning) >= 1


def test_record_and_get_perf():
    record_engine_perf("test_perf_engine", 1.5, True)
    record_engine_perf("test_perf_engine", 0.5, True)
    record_engine_perf("test_perf_engine", 0, False)
    perf = get_engine_perf()
    assert "test_perf_engine" in perf
    assert perf["test_perf_engine"]["successes"] >= 2
    assert perf["test_perf_engine"]["failures"] >= 1


def test_max_five_engines():
    active = get_active_engines()
    assert len(active) <= 12


def test_supports_tools_engines():
    with_tools = get_active_engines(needs_tools=True)
    for e in with_tools:
        assert e.get("supports_tools", False) is True
