import os, time, threading, json, re
import requests

BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "")
_last_update_id = 0
_bot_active = False
_poll_thread = None
# chat_id → current project name
_chat_projects = {}

def _get_updates():
    global _last_update_id
    if not BOT_TOKEN:
        return
    url = f"https://api.telegram.org/bot{BOT_TOKEN}/getUpdates"
    params = {"timeout": 15, "offset": _last_update_id + 1}
    try:
        resp = requests.get(url, params=params, timeout=20)
        if resp.ok:
            data = resp.json()
            if data.get("ok") and data.get("result"):
                for update in data["result"]:
                    _last_update_id = update["update_id"]
                    msg = update.get("message", {})
                    chat_id = msg.get("chat", {}).get("id")
                    text = msg.get("text", "")
                    if chat_id and text:
                        yield chat_id, text
    except:
        pass

def send_to_telegram(chat_id, text):
    if not BOT_TOKEN or not chat_id:
        return False
    url = f"https://api.telegram.org/bot{BOT_TOKEN}/sendMessage"
    try:
        resp = requests.post(url, json={"chat_id": chat_id, "text": text[:4000], "parse_mode": "HTML"}, timeout=10)
        return resp.ok
    except:
        return False

def _get_project_name(chat_id):
    return _chat_projects.get(chat_id, "default")

def _list_projects():
    from config import PROJECT_FILE
    try:
        pfile = str(PROJECT_FILE)
        if os.path.exists(pfile):
            with open(pfile) as f:
                data = json.load(f)
            return data.get("projects", [])
    except:
        pass
    return ["default"]

def _set_project(chat_id, project):
    projects = _list_projects()
    if project not in projects and project != "default":
        return False
    _chat_projects[chat_id] = project
    return True

def _handle_message(chat_id, text):
    text = text.strip()
    # Commands
    if text.startswith("/"):
        parts = text.lower().split()
        cmd = parts[0]
        cmds = {
            "/start": "Γεια! Είμαι ο AIONCLAW bot. Στείλε μου οποιαδήποτε εντολή.\n\nΧρήση: @project_name: η εντολή σου",
            "/id": f"Το chat ID σου: {chat_id}",
            "/help": "Στείλε μου εντολές.\n\n@project_name: εντολή — για συγκεκριμένο project\n/project — δες τρέχον project\n/project NAME — άλλαξε project\n/projects — λίστα projects\n/id — chat ID\n/help — βοήθεια",
        }
        if cmd == "/project":
            if len(parts) >= 2:
                pname = parts[1]
                if _set_project(chat_id, pname):
                    send_to_telegram(chat_id, f"✅ Το project άλλαξε σε: <b>{pname}</b>")
                else:
                    send_to_telegram(chat_id, f"❌ Το project '{pname}' δεν υπάρχει. /projects για λίστα")
            else:
                send_to_telegram(chat_id, f"📁 Τρέχον project: <b>{_get_project_name(chat_id)}</b>")
            return
        if cmd == "/projects":
            projects = _list_projects()
            send_to_telegram(chat_id, "📁 Διαθέσιμα projects:\n" + "\n".join(f"• {p}" for p in projects))
            return
        reply = cmds.get(cmd)
        if reply:
            send_to_telegram(chat_id, reply)
            return
    # Parse @project_name: prefix
    m = re.match(r"^@(\w[\w\-]*):\s*(.*)", text)
    if m:
        pname = m.group(1)
        text = m.group(2)
        _set_project(chat_id, pname)
    project = _get_project_name(chat_id)
    # Process via CEO with project context
    from collaboration import run_sub_agent
    try:
        full_task = f"[Project: {project}]\n{text}" if project != "default" else text
        result = run_sub_agent("ceo", full_task)
        send_to_telegram(chat_id, result[:4000])
    except Exception as e:
        send_to_telegram(chat_id, f"❌ Σφάλμα: {str(e)[:200]}")

def _polling_loop():
    global _bot_active
    _bot_active = True
    while _bot_active:
        try:
            for chat_id, text in _get_updates():
                _handle_message(chat_id, text)
        except:
            pass
        time.sleep(1)

def start():
    global _poll_thread
    if not BOT_TOKEN:
        print("Telegram bot: no TELEGRAM_BOT_TOKEN set, skipping")
        return
    if _poll_thread and _poll_thread.is_alive():
        return
    _poll_thread = threading.Thread(target=_polling_loop, daemon=True)
    _poll_thread.start()
    print("Telegram bot: polling started")

def stop():
    global _bot_active
    _bot_active = False
    print("Telegram bot: stopped")
