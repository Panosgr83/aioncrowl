#!/bin/bash
# AIONCLAW - Start both backend and frontend
AIONCLAW_DIR="$(cd "$(dirname "$0")" && pwd)"

# Use Node 20+ for Vite 8 compatibility
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
CURRENT_NODE=$(node --version 2>/dev/null | cut -d'.' -f1 | cut -d'v' -f2)
if [ "$CURRENT_NODE" -lt 20 ] 2>/dev/null; then
  NODE20=$(nvm ls 2>/dev/null | grep -o 'v20\.[0-9]*\.[0-9]*' | head -1)
  if [ -n "$NODE20" ]; then
    nvm use "$NODE20" 2>/dev/null
    echo "Switched to Node $NODE20 for Vite compatibility"
  fi
fi

echo "Starting AIONCLAW..."
echo "Backend: http://127.0.0.1:9790"
echo "Frontend: http://127.0.0.1:5174"
echo ""

# Kill existing
kill $(lsof -ti:9790) 2>/dev/null
kill $(lsof -ti:5174) 2>/dev/null
sleep 1

# Start backend
cd "$AIONCLAW_DIR/backend"
source ~/AION/.env 2>/dev/null
export PORT=9790
nohup python3 main.py > /tmp/aionclaw-backend.log 2>&1 &
echo "Backend PID: $!"

# Start frontend
cd "$AIONCLAW_DIR/frontend"
nohup npx vite --host --port 5174 --strictPort > /tmp/aionclaw-frontend.log 2>&1 &
echo "Frontend PID: $!"

sleep 2
echo ""
echo "Backend health: $(curl -s http://127.0.0.1:9790/api/health | python3 -c 'import sys,json; print(json.load(sys.stdin)["status"])' 2>/dev/null || echo 'checking...')"

echo ""
echo "Open http://127.0.0.1:5174 in your browser"
