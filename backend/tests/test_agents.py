"""Tests for agent definitions, CEO routing, and prompts."""
import pytest
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from agents import AGENTS, get_agent, get_agents


def test_all_agents_defined():
    assert len(AGENTS) >= 15
    ids = [a["id"] for a in AGENTS]
    assert "ceo" in ids
    assert "offers" in ids
    assert "support" in ids
    assert "reporter" in ids


def test_agent_ids_unique():
    ids = [a["id"] for a in AGENTS]
    assert len(ids) == len(set(ids))


def test_get_agent_by_id():
    ceo = get_agent("ceo")
    assert ceo is not None
    assert ceo["id"] == "ceo"
    assert "icon" in ceo
    assert "name" in ceo
    assert "role" in ceo
    assert "system_prompt" in ceo


def test_get_agent_unknown():
    assert get_agent("nonexistent_agent") is None


def test_ceo_prompt_compact():
    ceo = get_agent("ceo")
    prompt = ceo["system_prompt"]
    assert len(prompt) < 2000
    assert "TASK|CONTEXT|TOOLS" in prompt or "TASK:" in prompt


def test_offers_prompt_no_delegate():
    offers = get_agent("offers")
    prompt = offers["system_prompt"]
    assert "ΑΠΑΓΟΡΕΥΕΤΑΙ" in prompt


def test_support_prompt_concise():
    support = get_agent("support")
    prompt = support["system_prompt"]
    assert "ΑΜΕΣΩΣ" in prompt or "1-2" in prompt


def test_agents_have_roles():
    for a in AGENTS:
        assert a.get("role"), f"Agent {a['id']} missing role"


def test_agents_have_icons():
    for a in AGENTS:
        assert a.get("icon"), f"Agent {a['id']} missing icon"


def test_get_agents_returns_filtered():
    all_agents = get_agents()
    for a in all_agents:
        assert "system_prompt" in a


def test_ceo_routing_table_refs_valid():
    ceo = get_agent("ceo")
    prompt = ceo["system_prompt"]
    agent_ids = {a["id"] for a in AGENTS}
    import re
    matches = re.findall(r'(?<!\w)(offers|support|leadfinder|reporter|developer|writer|analyst|researcher|editor|translator|summarizer|architect|strategist|designer|investigator|planner)(?!\w)', prompt)
    for m in matches:
        assert m in agent_ids, f"CEO routing references '{m}' which is not a valid agent id"
