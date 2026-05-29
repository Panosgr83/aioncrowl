import json, os

AION_DIR = os.path.expanduser("~/AION")
READS_FILE = os.path.join(AION_DIR, "MEMORY", "reads.json")

def get_reads():
    try:
        if os.path.exists(READS_FILE):
            with open(READS_FILE) as f:
                return json.load(f)
    except:
        pass
    return []

def mark_read(event_id):
    reads = get_reads()
    if event_id not in reads:
        reads.append(event_id)
        os.makedirs(os.path.dirname(READS_FILE), exist_ok=True)
        with open(READS_FILE, "w") as f:
            json.dump(reads, f, indent=2)
    return True

def mark_unread(event_id):
    reads = get_reads()
    if event_id in reads:
        reads.remove(event_id)
        with open(READS_FILE, "w") as f:
            json.dump(reads, f, indent=2)
    return True
