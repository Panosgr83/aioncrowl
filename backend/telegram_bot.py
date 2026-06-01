import os, time, threading, json
import requests

BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "")
_last_update_id = 0
_bot_active = False
_poll_thread = None

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

def _handle_message(chat_id, text):
    text = text.strip()
    if text.startswith("/"):
        cmd = text.lower().split()[0]
        cmds = {
            "/start": "Γεια! Είμαι ο AIONCLAW bot. Στείλε μου οποιαδήποτε εντολή.",
            "/id": f"Το chat ID σου: {chat_id}",
            "/help": "Στείλε μου μια εντολή και θα την επεξεργαστώ.\n\nΔιαθέσιμες εντολές:\n/start - Εκκίνηση\n/id - Το chat ID σου\n/help - Αυτή η βοήθεια",
        }
        reply = cmds.get(cmd)
        if reply:
            send_to_telegram(chat_id, reply)
            return
    from collaboration import run_sub_agent
    try:
        result = run_sub_agent("ceo", text)
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
