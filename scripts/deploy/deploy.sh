#!/usr/bin/env bash
set -euo pipefail

# ─────────────────────────────────────────────
# AIONCLAW VPS Deployment Script
# Tested on: Ubuntu 24.04 LTS
# ─────────────────────────────────────────────

REPO_URL="https://github.com/Panosgr83/aioncrowl.git"
APP_DIR="/opt/aionclaw"
DATA_DIR="/home/aion/AION"
DOMAIN="${1:-}"
AION_USER="aion"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
log()  { echo -e "${CYAN}[$(date +%H:%M:%S)]${NC} $1"; }
ok()   { echo -e "  ${GREEN}✓${NC} $1"; }
warn() { echo -e "  ${YELLOW}⚠${NC} $1"; }
fail() { echo -e "  ${RED}✕${NC} $1"; exit 1; }

if [ "$(id -u)" -ne 0 ]; then fail "Run as root: sudo bash deploy.sh your-domain.com"; fi
if [ -z "$DOMAIN" ]; then fail "Usage: sudo bash deploy.sh your-domain.com"; fi

log "${GREEN}══════════════════════════════════════${NC}"
log "${GREEN}  AIONCLAW VPS Deployment — $DOMAIN${NC}"
log "${GREEN}══════════════════════════════════════${NC}"

# ── 1. System packages ──
log "\n${YELLOW}[1/8]${NC} Installing system packages..."
apt-get update -qq
apt-get install -y -qq \
    python3 python3-pip python3-venv \
    nodejs npm \
    nginx certbot python3-certbot-nginx \
    ufw fail2ban \
    git curl sqlite3
ok "System packages installed"

# ── 2. Create aion user ──
log "\n${YELLOW}[2/8]${NC} Creating system user..."
if ! id -u "$AION_USER" &>/dev/null; then
    useradd -m -s /bin/bash "$AION_USER"
    ok "User $AION_USER created"
else
    ok "User $AION_USER already exists"
fi

# ── 3. Clone / update repo ──
log "\n${YELLOW}[3/8]${NC} Deploying application..."
if [ -d "$APP_DIR" ]; then
    cd "$APP_DIR"
    git pull
    ok "Repo updated"
else
    git clone "$REPO_URL" "$APP_DIR"
    ok "Repo cloned to $APP_DIR"
fi

# ── 4. Python dependencies ──
log "\n${YELLOW}[4/8]${NC} Installing Python dependencies..."
python3 -m venv "$APP_DIR/venv"
source "$APP_DIR/venv/bin/activate"
pip install --quiet --upgrade pip
pip install --quiet \
    fastapi uvicorn[standard] pydantic \
    websockets httpx aiofiles \
    pyngrok \
    numpy
deactivate
ok "Python deps installed"

# ── 5. Frontend build ──
log "\n${YELLOW}[5/8]${NC} Building frontend..."
cd "$APP_DIR/frontend"
npm install --silent
npx vite build --logLevel error
ok "Frontend built"

# ── 6. Nginx + SSL ──
log "\n${YELLOW}[6/8]${NC} Configuring Nginx & SSL..."
cp "$APP_DIR/scripts/deploy/aionclaw.nginx" /etc/nginx/sites-available/aionclaw
sed -i "s/your-domain.com/$DOMAIN/g" /etc/nginx/sites-available/aionclaw
ln -sf /etc/nginx/sites-available/aionclaw /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx
ok "Nginx configured"

log "  Obtaining SSL certificate from Let's Encrypt..."
certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --email "admin@$DOMAIN" || \
    warn "SSL failed — run later: certbot --nginx -d $DOMAIN"
ok "SSL configured"

# ── 7. Firewall + Fail2ban ──
log "\n${YELLOW}[7/8]${NC} Securing server..."
ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow ssh
ufw allow http
ufw allow https
ufw --force enable
ok "UFW firewall active (22, 80, 443)"

cat > /etc/fail2ban/jail.local <<'F2B'
[DEFAULT]
bantime = 3600
findtime = 600
maxretry = 5

[sshd]
enabled = true

[nginx-http-auth]
enabled = true
F2B
systemctl restart fail2ban
ok "Fail2ban active"

# ── 8. Data directory + .env ──
log "\n${YELLOW}[8/8]${NC} Setting up data & environment..."
mkdir -p "$DATA_DIR/MEMORY" "$DATA_DIR/knowledge" "$DATA_DIR/sessions"

if [ ! -f "$DATA_DIR/.env" ]; then
    cat > "$DATA_DIR/.env" <<'ENV'
# AIONCLAW Environment — fill in your API keys
# export CEREBRAS_API_KEY=your_key
# export OPENROUTER_API_KEY=your_key
# export GROQ_API_KEY=your_key
# export GEMINI_API_KEY=your_key
# export SAMBANOVA_API_KEY=your_key
# export PERPLEXITY_API_KEY=your_key
# export NGROK_AUTH_TOKEN=your_ngrok_token
ENV
    warn "Edit $DATA_DIR/.env and add your API keys"
else
    ok ".env already exists"
fi

chown -R "$AION_USER:$AION_USER" "$DATA_DIR" "$APP_DIR"

# ── systemd service ──
log "\n${YELLOW}→${NC} Installing systemd service..."
cp "$APP_DIR/scripts/deploy/aionclaw.service" /etc/systemd/system/
sed -i "s|/home/aion/AION|$DATA_DIR|g" /etc/systemd/system/aionclaw.service
systemctl daemon-reload
systemctl enable aionclaw
systemctl restart aionclaw
ok "aionclaw service started"

# ── Done ──
log "\n${GREEN}══════════════════════════════════════${NC}"
log "${GREEN}  ✅ Deployment complete!${NC}"
log "${GREEN}  https://$DOMAIN${NC}"
log "${GREEN}══════════════════════════════════════${NC}"
echo ""
log "Next steps:"
log "  1. Edit $DATA_DIR/.env → add your API keys"
log "  2. sudo systemctl restart aionclaw"
log "  3. Check logs: sudo journalctl -u aionclaw -f"
