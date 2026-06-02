import os, time, threading, json, re, queue
import requests

CHAT_ID = int(os.environ.get("TELEGRAM_CHAT_ID", "0"))
_event_queue = queue.Queue()

# ── Event queue: push from collaboration.py / main.py ──
def push_event(project, event_type, agent_id, details="", duration=None):
    _event_queue.put({
        "project": project,
        "type": event_type,
        "agent_id": agent_id,
        "details": details[:200] if details else "",
        "duration": duration,
        "ts": time.time(),
    })

# ── ProjectBot: one bot per project ──
class ProjectBot:
    def __init__(self, token, project):
        self.token = token
        self.project = project
        self.chat_id = CHAT_ID
        self._last_update_id = 0
        self._active = False
        self._thread = None

    def send(self, text):
        if not self.token or not self.chat_id:
            return False
        url = f"https://api.telegram.org/bot{self.token}/sendMessage"
        try:
            resp = requests.post(url, json={
                "chat_id": self.chat_id, "text": text[:4000], "parse_mode": "HTML",
            }, timeout=10)
            return resp.ok
        except:
            return False

    def _command_list(self):
        return (
            f"📋 <b>Εντολές για {self.project}</b>\n\n"
            f"/start — αυτή η λίστα\n"
            f"/project — τρέχον project\n"
            f"/status — κατάσταση agents\n"
            f"/id — chat ID\n"
            f"/help — βοήθεια\n\n"
            f"━━━━━━━━━━━━━━━━\n"
            f"Αυτό το bot δέχεται events για το <b>{self.project}</b>.\n"
            f"Στείλε μου εντολές ή διάταξε agents με @project: εντολή"
        )

    def _get_updates(self):
        url = f"https://api.telegram.org/bot{self.token}/getUpdates"
        params = {"timeout": 15, "offset": self._last_update_id + 1}
        try:
            resp = requests.get(url, params=params, timeout=20)
            if resp.ok:
                data = resp.json()
                if data.get("ok") and data.get("result"):
                    for update in data["result"]:
                        self._last_update_id = update["update_id"]
                        msg = update.get("message", {})
                        chat_id = msg.get("chat", {}).get("id")
                        text = msg.get("text", "")
                        if chat_id and text:
                            yield chat_id, text
        except:
            pass

    def _handle(self, chat_id, text):
        text = text.strip()
        if text.startswith("/"):
            cmd = text.lower().split()[0]
            if cmd == "/start":
                self.send(self._command_list())
            elif cmd == "/help":
                self.send(self._command_list())
            elif cmd == "/project":
                self.send(f"📁 <b>{self.project}</b>")
            elif cmd == "/id":
                self.send(f"Το chat ID σου: {chat_id}")
            elif cmd == "/status":
                self.send(f"📊 <b>{self.project}</b> — bots active")
            return True
        # Route as CEO command with project context
        from collaboration import run_sub_agent, save_to_agent_session
        try:
            full_task = f"[Project: {self.project}]\n{text}" if self.project != "default" else text
            result = run_sub_agent("ceo", full_task)
            self.send(result[:4000])
            tg_text = f"📱 [{self.project}] {text}" if self.project != "default" else f"📱 {text}"
            save_to_agent_session("ceo", "default", tg_text, result[:4000], project=self.project)
        except Exception as e:
            self.send(f"❌ Σφάλμα: {str(e)[:200]}")
        return True

    def _poll_loop(self):
        self._active = True
        while self._active:
            try:
                for cid, txt in self._get_updates():
                    self._handle(cid, txt)
            except:
                pass
            time.sleep(1)

    def start(self):
        if self._thread and self._thread.is_alive():
            return
        self._active = True
        self._thread = threading.Thread(target=self._poll_loop, daemon=True)
        self._thread.start()
        print(f"Telegram bot: started for project '{self.project}'")

    def stop(self):
        self._active = False
        print(f"Telegram bot: stopped for project '{self.project}'")


# ── Bot manager ──
_bots = {}  # project_name → ProjectBot

def _load_bots():
    for key, val in sorted(os.environ.items()):
        if key.startswith("TELEGRAM_BOT_") and key != "TELEGRAM_BOT_TOKEN":
            project = key[len("TELEGRAM_BOT_"):].lower()
            if val and project:
                _bots[project] = ProjectBot(val, project)
    # Legacy: TELEGRAM_BOT_TOKEN → "default"
    legacy = os.environ.get("TELEGRAM_BOT_TOKEN", "")
    if legacy and "default" not in _bots:
        _bots["default"] = ProjectBot(legacy, "default")

def get_bot(project):
    project = project.replace(" ", "_").lower()
    # Exact match
    if project in _bots:
        return _bots[project]
    # Try normalized
    norm = re.sub(r"[^a-z0-9_]", "", project)
    if norm in _bots:
        return _bots[norm]
    # Fallback: default
    return _bots.get("default")

def available_projects():
    return sorted(_bots.keys())


# ── Event consumer ──
_event_consumer_active = False
_event_consumer_thread = None

def _event_consumer_loop():
    global _event_consumer_active
    _event_consumer_active = True
    while _event_consumer_active:
        try:
            ev = _event_queue.get(timeout=1)
            bot = get_bot(ev["project"])
            if not bot or not bot.chat_id:
                continue
            t = ev["type"]
            agent = ev["agent_id"]
            details = ev["details"]
            dur = ev.get("duration")
            icons = {"started": "⏳", "complete": "✅", "error": "❌", "tool": "🔧", "thinking": "💭"}
            icon = icons.get(t, "📋")
            msg = f"{icon} <b>[{ev['project']}]</b> {agent}"
            if details:
                msg += f" {details[:200]}"
            if dur:
                msg += f" ({dur:.1f}s)"
            bot.send(msg)
        except queue.Empty:
            continue
        except Exception as e:
            print(f"Event consumer error: {e}")

def start_event_consumer():
    global _event_consumer_thread, _event_consumer_active
    if _event_consumer_thread and _event_consumer_thread.is_alive():
        return
    _event_consumer_active = True
    _event_consumer_thread = threading.Thread(target=_event_consumer_loop, daemon=True)
    _event_consumer_thread.start()
    print("Telegram event consumer: started")


# ── Auto 24/7 mode ──
_auto_active = False
_auto_thread = None
AUTO_PROMPT = """ΑΥΤΟΝΟΜΟ 24/7 MODE — Είσαι ο CEO. Δουλεύεις αυτόνομα 24/7 χωρίς να περιμένεις εντολές.

ΣΕ ΑΥΤΟΝ ΤΟΝ ΚΥΚΛΟ:
1. Έλεγξε την κατάσταση — χρησιμοποίησε get_agent_history για να δεις τι έγινε πριν
2. Δες τι tasks εκκρεμούν από προηγούμενους κύκλους
3. Αν υπάρχει δουλειά να γίνει (π.χ. monitoring, ανάπτυξη, έρευνα), ανέθεσέ την
4. Αν όλα είναι υπό έλεγχο, μην κάνεις τίποτα — περίμενε τον επόμενο κύκλο

ΚΑΝΟΝΕΣ:
- ΜΗΝ επαναλαμβάνεις την ίδια εργασία
- ΜΗΝ στέλνεις κενές αναφορές — αν δεν υπάρχει νέο αποτέλεσμα, πες μόνο 'tick'
- ΑΝΑΦΕΡΕ μόνο όταν υπάρχει ουσιαστική πρόοδος ή πρόβλημα
- Ανέθεσε μακροχρόνιες εργασίες (π.χ. newsletter 30.000 emails) σε agents και συνέχισε να ελέγχεις"""

def _auto_loop(interval, projects=None):
    global _auto_active
    last_report = ""
    while _auto_active:
        try:
            from collaboration import run_sub_agent, save_to_agent_session
            for project in (projects or ["default"]):
                bot = get_bot(project)
                if not bot or not bot.chat_id:
                    continue
                sdir = os.path.join(str(__import__("config", fromlist=["SESSIONS_DIR"]).SESSIONS_DIR), project)
                sf = os.path.join(sdir, f"ceo_telegram_{project.replace('-','_')}.json")
                context = ""
                try:
                    if os.path.exists(sf):
                        with open(sf) as f:
                            msgs = json.load(f).get("messages", [])[-6:]
                        context = "Πρόσφατη συνομιλία:\n" + "\n".join(
                            f"{m['role']}: {m['content'][:200]}" for m in msgs if m.get('content')
                        )
                except:
                    pass
                full_task = f"[Project: {project}]\n{context}\n\n{AUTO_PROMPT}"
                result = run_sub_agent("ceo", full_task)
                if result and _auto_active:
                    is_tick = len(result) < 10 or result.strip().lower() == 'tick'
                    bot.send(result[:3500])
                    if not is_tick:
                        save_to_agent_session("ceo", "default", f"♾️ [{project}] auto", result[:3500], project=project)
                        _broadcast_auto(project, result[:3000])
        except Exception as e:
            if _auto_active:
                print(f"Auto loop error: {e}")
        for _ in range(int(interval / 1)):
            if not _auto_active:
                break
            time.sleep(1)

def _broadcast_auto(project, text):
    try:
        from collaboration import bus
        import asyncio
        loop = asyncio.get_event_loop()
        if loop and loop.is_running():
            asyncio.run_coroutine_threadsafe(
                _async_broadcast_auto(project, text), loop
            )
    except:
        pass

async def _async_broadcast_auto(project, text):
    from collaboration import bus
    bus.broadcast({
        "type": "auto_result",
        "project": project,
        "content": text[:1000],
        "ts": __import__('datetime').datetime.now().isoformat(),
    })

def start_auto(interval=120):
    global _auto_active, _auto_thread
    if _auto_active:
        return
    _auto_active = True
    projects = available_projects()
    _auto_thread = threading.Thread(target=_auto_loop, args=(interval, projects), daemon=True)
    _auto_thread.start()
    print(f"Telegram auto: started 24/7 autonomous mode for {len(projects)} projects interval={interval}s")

def stop_auto():
    global _auto_active
    _auto_active = False
    print("Telegram auto: stopped")


# ── Public API ──
def send_to_telegram(chat_id, text):
    """Legacy: sends to all bots the user has access to."""
    sent = False
    for bot in _bots.values():
        if bot.chat_id == chat_id:
            bot.send(text)
            sent = True
    if not sent:
        # Try default bot
        bot = _bots.get("default")
        if bot:
            bot.send(text)
            sent = True
    return sent

def start():
    _load_bots()
    if not _bots:
        print("Telegram bot: no TELEGRAM_BOT_* tokens set, skipping")
        return
    for bot in _bots.values():
        bot.start()
    start_event_consumer()
    print(f"Telegram bot: {len(_bots)} bots active: {', '.join(available_projects())}")

def stop():
    for bot in _bots.values():
        bot.stop()
    global _event_consumer_active, _auto_active
    _event_consumer_active = False
    _auto_active = False
    print("Telegram bot: all bots stopped")
