#!/usr/bin/env python3
"""AIONCLAW CLI — start, stop, restart, status, logs."""

import os, sys, signal, time, json, subprocess

PID_FILE = "/tmp/aionclaw.pid"
LOG_FILE = "/tmp/aionclaw.log"
DEFAULT_PORT = 9789


def _find_pid():
    if os.path.exists(PID_FILE):
        try:
            with open(PID_FILE) as f:
                pid = int(f.read().strip())
            os.kill(pid, 0)
            return pid
        except (ValueError, ProcessLookupError, OSError):
            pass
    try:
        result = subprocess.run(
            ["pgrep", "-f", "uvicorn.*aionclaw"],
            capture_output=True, text=True, timeout=5
        )
        if result.stdout.strip():
            return int(result.stdout.strip().split()[0])
    except:
        pass
    return None


def _start(port=DEFAULT_PORT):
    pid = _find_pid()
    if pid:
        print(f"AIONCLAW is already running (PID {pid}). Use 'aionctl restart' or 'aionctl stop' first.")
        return

    backend_dir = os.path.dirname(os.path.abspath(__file__))
    log = open(LOG_FILE, "a")
    log.write(f"\n--- AIONCLAW start at {time.ctime()} ---\n")
    log.flush()

    env = os.environ.copy()
    env["PORT"] = str(port)

    proc = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "main:app", "--host", "127.0.0.1", "--port", str(port)],
        cwd=backend_dir,
        stdout=log,
        stderr=subprocess.STDOUT,
        env=env,
        start_new_session=True,
    )

    with open(PID_FILE, "w") as f:
        f.write(str(proc.pid))

    time.sleep(2)
    if _find_pid() == proc.pid:
        print(f"AIONCLAW started (PID {proc.pid}) on port {port}")
        print(f"Logs: {LOG_FILE}")
    else:
        print(f"Failed to start AIONCLAW. Check logs: {LOG_FILE}")


def _stop():
    pid = _find_pid()
    if not pid:
        print("AIONCLAW is not running.")
        return

    print(f"Stopping AIONCLAW (PID {pid})...")
    os.kill(pid, signal.SIGTERM)

    for _ in range(10):
        time.sleep(1)
        if not _find_pid():
            break

    if os.path.exists(PID_FILE):
        os.remove(PID_FILE)
    print("AIONCLAW stopped.")


def _restart(port=DEFAULT_PORT):
    _stop()
    time.sleep(2)
    _start(port)


def _status():
    pid = _find_pid()
    if pid:
        try:
            proc = subprocess.run(
                ["ps", "-p", str(pid), "-o", "etime="],
                capture_output=True, text=True, timeout=5
            )
            uptime = proc.stdout.strip()
            print(f"AIONCLAW is RUNNING (PID {pid}, uptime {uptime})")
        except:
            print(f"AIONCLAW is RUNNING (PID {pid})")
    else:
        print("AIONCLAW is STOPPED")


def _logs(lines=50):
    if not os.path.exists(LOG_FILE):
        print(f"Log file not found: {LOG_FILE}")
        return
    with open(LOG_FILE) as f:
        content = f.read()
    all_lines = content.strip().split("\n")
    tail = all_lines[-lines:]
    print("\n".join(tail))


def cli():
    if len(sys.argv) < 2:
        print("Usage: aionctl <start|stop|restart|status|logs> [port]")
        return

    cmd = sys.argv[1]
    port = int(sys.argv[2]) if len(sys.argv) > 2 else DEFAULT_PORT

    if cmd == "start":
        _start(port)
    elif cmd == "stop":
        _stop()
    elif cmd == "restart":
        _restart(port)
    elif cmd == "status":
        _status()
    elif cmd == "logs":
        lines = int(sys.argv[2]) if len(sys.argv) > 2 else 50
        _logs(lines)
    else:
        print(f"Unknown command: {cmd}")
        print("Usage: aionctl <start|stop|restart|status|logs> [port]")


if __name__ == "__main__":
    cli()
