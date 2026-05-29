#!/bin/bash
# AIONCLAW - Start both backend and frontend
AIONCLAW_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "Starting AIONCLAW..."
echo "Backend: http://127.0.0.1:9789"
echo "Frontend: http://127.0.0.1:5173"
echo ""

# Kill existing
kill $(lsof -ti:9789) 2>/dev/null
kill $(lsof -ti:5173) 2>/dev/null
sleep 1

# Start backend
cd "$AIONCLAW_DIR/backend"
nohup python3 main.py > /tmp/aionclaw-backend.log 2>&1 &
echo "Backend PID: $!"

# Start frontend
cd "$AIONCLAW_DIR/frontend"
nohup npx vite --host > /tmp/aionclaw-frontend.log 2>&1 &
echo "Frontend PID: $!"

sleep 2
echo ""
echo "Backend health: $(curl -s http://127.0.0.1:9789/api/health | python3 -c 'import sys,json; print(json.load(sys.stdin)["status"])' 2>/dev/null || echo 'checking...')"

echo ""
echo "Open http://127.0.0.1:5173 in your browser"
