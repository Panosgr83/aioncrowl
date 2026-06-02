import json, os, time, asyncio, uuid
from datetime import datetime
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, HTTPException
from collaboration import bus
from engine import ENGINES as eng_list, get_active_engines as ga_engines, call_engine, mark_engine, suggest_engine_for, record_engine_perf
from tools import get_tool_definitions_for_agent, execute_tool
from memory_summary import needs_summary, summarize_conversation
from shared import (
    sessions, session_engine_cache, active_connections,
    AgentContext, ChatRequest, ChatResponse, run_agent,
    trim_messages, _load_project, _session_file, UPLOAD_DIR,
    detect_injection,
)

router = APIRouter(tags=["chat"])


@router.post("/api/chat")
async def chat(req: ChatRequest):
    if detect_injection(req.message):
        return ChatResponse(
            response="Το μήνυμά σας περιέχει μη επιτρεπόμενες εντολές — παρακαλώ αναδιατυπώστε το.",
            engine_used="none",
            tool_calls=[],
            finish_reason="stop"
        )
    ctx = sessions.get(req.session_id)
    if not ctx:
        ctx = AgentContext(req.system_prompt, req.tools_enabled, agent_id=req.agent_id, session_id=req.session_id)
        sessions[req.session_id] = ctx
    ctx.add_message("user", req.message)
    result = run_agent(ctx, req.engine_id)
    if needs_summary(ctx.messages):
        active = ga_engines()
        if active:
            try:
                await summarize_conversation(call_engine, active[0], trim_messages(ctx.messages), ctx.agent_id)
            except:
                pass
    return ChatResponse(
        response=result["response"],
        engine_used=result["engine_used"],
        tool_calls=result.get("tool_calls", []),
        finish_reason="stop"
    )


@router.websocket("/ws/chat")
async def websocket_chat(ws: WebSocket):
    await ws.accept()
    client_id = str(uuid.uuid4())[:8]
    active_connections.add(ws)

    async def _keepalive():
        try:
            while True:
                await asyncio.sleep(25)
                await ws.send_json({"type": "ka"})
        except:
            pass
    ka_task = asyncio.create_task(_keepalive())

    print(f"WS client connected: {client_id}")

    try:
        while True:
            data = await ws.receive_json()
            session_id = data.get("session_id", "default")
            system_prompt = data.get("system_prompt", "")
            tools_enabled = data.get("tools_enabled", True)
            engine_override = data.get("engine_id", "")
            agent_id = data.get("agent_id", "ceo")
            selected_agents = data.get("selected_agents", [])

            if selected_agents and len(selected_agents) > 0:
                agent_list_str = ", ".join(selected_agents)
                system_prompt = (system_prompt or "") + f"\n\nΟ ΧΡΗΣΤΗΣ ΕΠΕΛΕΞΕ ΤΟΥΣ ΑΚΟΛΟΥΘΟΥΣ AGENTS: {agent_list_str}. Χρησιμοποίησε ΜΟΝΟ αυτούς τους agents. Αν χρειαστείς βοήθεια, στείλε ΜΟΝΟ στους επιλεγμένους agents: {agent_list_str}. ΜΗΝ χρησιμοποιήσεις κανέναν άλλον agent."

            def ws_send(msg):
                msg["_aid"] = agent_id
                msg["_sid"] = session_id.split(":", 1)[-1] if ":" in session_id else session_id
                return ws.send_json(msg)

            user_msg = data.get("message", "")
            if detect_injection(user_msg):
                await ws.send_json({"type": "error", "message": "Το μήνυμά σας περιέχει μη επιτρεπόμενες εντολές — παρακαλώ αναδιατυπώστε το."})
                continue

            ctx = sessions.get(session_id)
            if not ctx:
                ctx = AgentContext(system_prompt, tools_enabled, agent_id=agent_id, session_id=session_id)
                sessions[session_id] = ctx

            ctx.add_message("user", user_msg)
            bus.status(agent_id, True, "writing")
            ws_start_time = time.time()

            bus.broadcast({
                "type": "agent_thinking",
                "agent_id": agent_id,
                "status": "started",
                "thought": f"🤔 {agent_id}: επεξεργάζεται το μήνυμά σας...",
                "ts": datetime.now().isoformat(),
            })

            if engine_override:
                engines_to_try = [e for e in eng_list if e["id"] == engine_override] or []
                if not engines_to_try:
                    engines_to_try = ga_engines()
            else:
                task_type = "reasoning" if agent_id == "ceo" else ("simple" if not tools_enabled else "general")
                suggested = suggest_engine_for(task_type, needs_tools=tools_enabled)
                engines_to_try = ga_engines(task_type=task_type, needs_tools=tools_enabled)
                if suggested and suggested in engines_to_try:
                    engines_to_try = [suggested] + [e for e in engines_to_try if e["id"] != suggested["id"]]
                cached_id = session_engine_cache.get(session_id)
                if cached_id:
                    cached = next((e for e in eng_list if e["id"] == cached_id), None)
                    if cached and cached in engines_to_try:
                        engines_to_try = [cached] + [e for e in engines_to_try if e["id"] != cached_id]

            last_error = ""
            response_text = ""
            tool_calls_made = []
            engine_used = "none"

            for engine in engines_to_try:
                if tools_enabled and not engine.get("supports_tools", False):
                    continue
                try:
                    t0 = time.time()
                    engine_used = engine["id"]
                    await ws_send({"type": "status", "engine": engine["id"], "status": "calling"})
                    bus.broadcast({
                        "type": "engine_call",
                        "engine_id": engine["id"],
                        "agent_id": agent_id,
                        "status": "started",
                        "ts": datetime.now().isoformat(),
                    })
                    bus.broadcast({
                        "type": "agent_thinking",
                        "agent_id": agent_id,
                        "status": "started",
                        "thought": f"⏳ {agent_id}: επεξεργάζεται μέσω {engine['id']}...",
                        "ts": datetime.now().isoformat(),
                    })

                    tools_for_call = get_tool_definitions_for_agent(agent_id) if tools_enabled else None
                    init_resp = call_engine(engine, trim_messages(ctx.messages), tools=tools_for_call, stream=False)
                    init_data = init_resp.json()
                    init_choice = init_data["choices"][0]
                    init_msg = init_choice["message"]
                    init_content = init_msg.get("content", "")

                    tool_calls = init_msg.get("tool_calls")
                    if not tool_calls:
                        from tools import parse_xml_tool_calls
                        xml_tools, cleaned = parse_xml_tool_calls(init_content)
                        if xml_tools:
                            tool_calls = xml_tools
                            init_content = cleaned

                    if tool_calls:
                        ctx.add_message("assistant", init_content, tool_calls=tool_calls)
                        await ws_send({"type": "tool_calls", "tool_calls": tool_calls})

                        total_tools = len(tool_calls)
                        for ti, tc in enumerate(tool_calls):
                            func_name = tc.get("function", {}).get("name", "")
                            func_args = json.loads(tc.get("function", {}).get("arguments", "{}")) if tc.get("function", {}).get("arguments") else {}
                            tc_id = tc.get("id", "")
                            await ws_send({"type": "tool_start", "name": func_name, "args": func_args})
                            bus.broadcast({
                                "type": "task_progress",
                                "agent_id": agent_id,
                                "status": "running",
                                "progress": min(int((ti + 1) / total_tools * 95), 95),
                                "message": f"🔧 {func_name} ({ti+1}/{total_tools})",
                                "ts": datetime.now().isoformat(),
                            })
                            bus.broadcast({
                                "type": "agent_thinking",
                                "agent_id": agent_id,
                                "status": "thinking",
                                "thought": f"💭 {agent_id}: εκτελεί {func_name} ({ti+1}/{total_tools})",
                                "ts": datetime.now().isoformat(),
                            })
                            result = await asyncio.to_thread(execute_tool, func_name, func_args, ctx.agent_id)
                            await ws_send({"type": "tool_result", "name": func_name, "result": result[:500]})
                            ctx.add_message("tool", result, tool_call_id=tc_id)
                            tool_calls_made.append({"name": func_name, "result": result[:200]})

                        bus.broadcast({
                            "type": "agent_thinking",
                            "agent_id": agent_id,
                            "status": "synthesizing",
                            "thought": f"🧠 {agent_id}: συνθέτει αποτελέσματα...",
                            "ts": datetime.now().isoformat(),
                        })

                        t2 = time.time()
                        syn_type = "reasoning" if agent_id == "ceo" else task_type
                        syn_resp = call_engine(engine, trim_messages(ctx.messages), stream=True, max_tokens=1024, task_type=syn_type)
                        full_content = ""
                        for line in syn_resp.iter_lines():
                            if not line: continue
                            if line.startswith(b"data: "):
                                cs = line[6:].decode()
                                if cs == "[DONE]": break
                                try:
                                    chunk = json.loads(cs)
                                    d = chunk.get("choices", [{}])[0].get("delta", {})
                                    if d.get("content"):
                                        full_content += d["content"]
                                        await ws_send({"type": "delta", "content": d["content"]})
                                except: continue
                        record_engine_perf(engine["id"], time.time() - t2, True)
                        response_text = full_content
                        ctx.add_message("assistant", full_content)
                    else:
                        await ws_send({"type": "delta", "content": init_content, "ts": datetime.now().isoformat()})
                        ctx.add_message("assistant", init_content)
                        response_text = init_content

                    if needs_summary(ctx.messages):
                        try:
                            await summarize_conversation(call_engine, engine, trim_messages(ctx.messages), ctx.agent_id)
                        except:
                            pass
                    bus.status(agent_id, False, "has_response")
                    bus.broadcast({
                        "type": "agent_thinking",
                        "agent_id": agent_id,
                        "status": "complete",
                        "thought": f"✅ {agent_id} ολοκλήρωσε την απάντηση",
                        "ts": datetime.now().isoformat(),
                    })
                    if tool_calls_made:
                        bus.broadcast({
                            "type": "task_progress",
                            "agent_id": agent_id,
                            "status": "complete",
                            "progress": 100,
                            "message": f"✅ {agent_id} completed",
                            "ts": datetime.now().isoformat(),
                        })
                    bus.broadcast({
                        "type": "agent_chat",
                        "agent_id": agent_id,
                        "session_id": session_id.split(":", 1)[-1] if ":" in session_id else session_id,
                        "exchange": [
                            {"role": "user", "content": data.get("message", ""), "_aid": agent_id, "_sid": session_id.split(":", 1)[-1] if ":" in session_id else session_id},
                            {"role": "assistant", "content": (response_text or "")[:3000], "_aid": agent_id, "_sid": session_id.split(":", 1)[-1] if ":" in session_id else session_id},
                        ]
                    })
                    session_engine_cache[session_id] = engine_used
                    await ws_send({"type": "done", "engine": engine_used, "tool_calls": tool_calls_made})
                    try:
                        from performance import log_performance
                        perf_duration = time.time() - ws_start_time
                        log_performance(agent_id, data.get("message",""), perf_duration, engine_used, True, tool_calls=len(tool_calls_made))
                    except: pass
                    break

                except Exception as e:
                    last_error = f"[{engine['id']}] {e}"
                    record_engine_perf(engine["id"], 0, False)
                    error_lower = str(e).lower()
                    if "rate limit" in error_lower or "too large" in error_lower:
                        mark_engine(engine["id"], "rate_limited", 300)
                    elif "quota" in error_lower or "billing" in error_lower:
                        mark_engine(engine["id"], "quota_exhausted", 7200)
                    elif "timeout" in error_lower or "connection" in error_lower:
                        mark_engine(engine["id"], "timeout", 120)
                    continue
            else:
                bus.status(agent_id, False, "failure")
                bus.broadcast({
                    "type": "agent_thinking",
                    "agent_id": agent_id,
                    "status": "error",
                    "thought": f"❌ {agent_id} απέτυχε: {last_error[:100]}",
                    "ts": datetime.now().isoformat(),
                })
                await ws_send({"type": "error", "message": f"Σφάλμα σε όλα τα engines: {last_error}"})

    except WebSocketDisconnect:
        pass
    except Exception as e:
        try:
            await ws_send({"type": "error", "message": str(e)[:500]})
        except:
            pass
    finally:
        active_connections.discard(ws)
        try: ka_task.cancel()
        except: pass
        print(f"WS client disconnected: {client_id}")


@router.websocket("/ws/collab")
async def websocket_collab(ws: WebSocket):
    await ws.accept()
    bus.connections.add(ws)

    async def _keepalive():
        try:
            while True:
                await asyncio.sleep(25)
                await ws.send_json({"type": "ka"})
        except:
            pass
    ka_task = asyncio.create_task(_keepalive())

    print("Collab WS connected")
    try:
        while True:
            data = await ws.receive_text()
            msg = json.loads(data)
            if msg.get("type") == "ping":
                await ws.send_json({"type": "pong"})
    except:
        pass
    finally:
        bus.connections.discard(ws)
        try: ka_task.cancel()
        except: pass
        print("Collab WS disconnected")
