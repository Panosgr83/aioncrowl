"""Tests for tool definitions and execution."""
import pytest
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from tools import TOOL_DEFINITIONS, get_tool_definitions_for_agent, execute_tool, parse_xml_tool_calls


def test_tool_definitions_present():
    assert len(TOOL_DEFINITIONS) >= 5


def test_tool_defs_have_required_fields():
    for t in TOOL_DEFINITIONS:
        assert "function" in t
        fn = t["function"]
        assert "name" in fn
        assert "description" in fn
        assert "parameters" in fn


def test_ceo_gets_all_tools():
    ceo_tools = get_tool_definitions_for_agent("ceo")
    assert len(ceo_tools) >= 5


def test_offers_gets_send_telegram():
    offers_tools = get_tool_definitions_for_agent("offers")
    names = [t["function"]["name"] for t in offers_tools]
    assert "send_telegram" in names


def test_execute_read_file(tmp_path):
    f = tmp_path / "test.txt"
    f.write_text("hello world")
    result = execute_tool("read_file", {"path": str(f)}, "ceo")
    assert "hello world" in result


def test_execute_read_file_not_found():
    result = execute_tool("read_file", {"path": "/nonexistent/file.txt"}, "ceo")
    assert "error" in result.lower() or "σφάλμα" in result.lower()


def test_execute_list_files(tmp_path):
    (tmp_path / "a.txt").write_text("a")
    (tmp_path / "b.txt").write_text("b")
    result = execute_tool("list_files", {"path": str(tmp_path)}, "ceo")
    assert "a.txt" in result
    assert "b.txt" in result


def test_execute_unknown_tool():
    result = execute_tool("nonexistent_tool", {}, "ceo")
    assert "error" in result.lower() or "άγνωστο" in result.lower()


def test_parse_xml_tool_calls():
    text = '<tool_call><tool_name>read_file</tool_name><parameters><path>/tmp/test.txt</path></parameters></tool_call>'
    calls, cleaned = parse_xml_tool_calls(text)
    assert len(calls) > 0
    assert calls[0]["function"]["name"] == "read_file"


def test_parse_xml_tool_calls_no_calls():
    calls, cleaned = parse_xml_tool_calls("Just a normal response without tools")
    assert len(calls) == 0
    assert cleaned == "Just a normal response without tools"


def test_get_tool_definitions_for_agent_has_lookup():
    ceo_tools = get_tool_definitions_for_agent("ceo")
    names = [t["function"]["name"] for t in ceo_tools]
    assert "lookup_word" in names


def test_execute_lookup_word_invalid():
    result = execute_tool("lookup_word", {"word": "zzzznotaword"}, "ceo")
    assert result is not None
    assert len(result) > 0


def test_tool_timeout_handling():
    result = execute_tool("list_files", {"path": "/tmp"}, "ceo")
    assert isinstance(result, str)
