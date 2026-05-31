#!/usr/bin/env bash
set -euo pipefail

# ─────────────────────────────────────────────
# AIONCLAW Local Deployment (macOS)
# Installs as a launchd service + ngrok tunnel
# ─────────────────────────────────────────────

AIONCLAW_DIR="$HOME/AION/aionclaw"
BACKEND_DIR="$AIONCLAW_DIR/backend"
FRONTEND_DIR="$AIONCLAW_DIR/frontend"
PLIST="$AIONCLAW_DIR/scripts/deploy/com.aionclaw.backend.plist"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
log()  { echo -e "${CYAN}[$(date +%H:%M:%S)]${NC} $1"; }
ok()   { echo -e "  ${GREEN}✓${NC} $1"; }
warn() { echo -e "  ${YELLOW}⚠${NC} $1"; }
fail() { echo -e "  ${RED}✕${NC} $1"; exit 1; }

log "${GREEN}══════════════════════════════════════${NC}"
log "${GREEN}  AIONCLAW Local Deployment (macOS)${NC}"
log "${GREEN}══════════════════════════════════════${NC}"

# ── 1. Verify directories ──
log "\n${YELLOW}[1/5]${NC} Verifying project structure..."
[ -d "$BACKEND_DIR" ] || fail "Backend dir not found: $BACKEND_DIR"
[ -d "$FRONTEND_DIR" ] || fail "Frontend dir not found: $FRONTEND_DIR"
ok "Project structure OK"

# ── 2. Python deps ──
log "\n${YELLOW}[2/5]${NC} Checking Python dependencies..."
pip3 install --quiet --break-system-packages fastapi uvicorn pydantic websockets httpx aiofiles pyngrok 2>/dev/null || \
    pip3 install --quiet fastapi uvicorn pydantic websockets httpx aiofiles pyngrok
ok "Python deps OK"

# ── 3. Frontend build ──
log "\n${YELLOW}[3/5]${NC} Building frontend..."
cd "$FRONTEND_DIR"
npm install --silent 2>/dev/null
npx vite build --logLevel error
ok "Frontend built"

# ── 4. Install launchd service ──
log "\n${YELLOW}[4/5]${NC} Installing launchd service..."
cp "$PLIST" "$HOME/Library/LaunchAgents/"

# Unload if already loaded
launchctl unload "$HOME/Library/LaunchAgents/com.aionclaw.backend.plist" 2>/dev/null || true
launchctl load "$HOME/Library/LaunchAgents/com.aionclaw.backend.plist"
ok "launchd service installed & started"

# ── 5. Check NGROK_AUTH_TOKEN ──
log "\n${YELLOW}[5/5]${NC} Checking remote access..."
NGROK_TOKEN=$(grep '^export NGROK_AUTH_TOKEN=' "$HOME/AION/.env" 2>/dev/null | cut -d= -f2 | tr -d '"' || echo "")
if [ -n "$NGROK_TOKEN" ]; then
    ok "NGROK_AUTH_TOKEN found"
else
    warn "No NGROK_AUTH_TOKEN in ~/AION/.env"
    warn "Remote access via ngrok won't work until you add it"
fi

# ── Done ──
sleep 2
PORT=$(grep '^export PORT=' "$HOME/AION/.env" 2>/dev/null | cut -d= -f2 | tr -d '"' || echo "9790")
log "\n${GREEN}══════════════════════════════════════${NC}"
log "${GREEN}  ✅ Local deployment complete!${NC}"
log "${GREEN}  Backend:  http://127.0.0.1:$PORT${NC}"
log "${GREEN}  API:      http://127.0.0.1:$PORT/api/health${NC}"
log "${GREEN}  Logs:     tail -f /tmp/aionclaw-backend.log${NC}"
log "${GREEN}══════════════════════════════════════${NC}"
echo ""
log "Commands:"
log "  Start:    launchctl load ~/Library/LaunchAgents/com.aionclaw.backend.plist"
log "  Stop:     launchctl unload ~/Library/LaunchAgents/com.aionclaw.backend.plist"
log "  Logs:     tail -f /tmp/aionclaw-backend.log"
log "  Restart:  launchctl unload ... && launchctl load ..."
