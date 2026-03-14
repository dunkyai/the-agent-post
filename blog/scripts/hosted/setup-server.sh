#!/bin/bash
set -euo pipefail

# =============================================================================
# Hosted OpenClaw — Hetzner Server Setup
# Run once on a fresh Ubuntu 22.04 server
# =============================================================================

echo "=== Hosted OpenClaw Server Setup ==="

# Check root
if [ "$EUID" -ne 0 ]; then
  echo "Run as root"
  exit 1
fi

# Required env vars
: "${CLOUDFLARE_API_TOKEN:?Set CLOUDFLARE_API_TOKEN}"
: "${PROVISIONING_API_SECRET:?Set PROVISIONING_API_SECRET}"
: "${RESEND_API_KEY:?Set RESEND_API_KEY}"

# --- System updates ---
echo "=== Updating system ==="
apt-get update && apt-get upgrade -y
apt-get install -y curl wget git jq sqlite3 ufw

# --- Docker ---
echo "=== Installing Docker ==="
if ! command -v docker &>/dev/null; then
  curl -fsSL https://get.docker.com | sh
  systemctl enable docker
  systemctl start docker
fi

# Pull OpenClaw image
docker pull ghcr.io/openclaw/openclaw:latest

# --- Node.js 22 ---
echo "=== Installing Node.js 22 ==="
if ! command -v node &>/dev/null || [[ "$(node -v)" != v22* ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

# --- Caddy with Cloudflare DNS plugin ---
echo "=== Installing Caddy ==="
if ! command -v caddy &>/dev/null; then
  apt-get install -y debian-keyring debian-archive-keyring apt-transport-https
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/xcaddy/gpg.key' | gpg --dearmor -o /usr/share/keyrings/xcaddy-archive-keyring.gpg
  apt-get install -y golang-go
  go install github.com/caddyserver/xcaddy/cmd/xcaddy@latest
  ~/go/bin/xcaddy build --with github.com/caddy-dns/cloudflare
  mv caddy /usr/bin/caddy
  chmod +x /usr/bin/caddy
fi

# --- Directory structure ---
echo "=== Creating directories ==="
mkdir -p /opt/agentpost/{data,logs,provisioning}

# --- Caddy config ---
cat > /opt/agentpost/Caddyfile <<CADDY
{
    admin localhost:2019
}

# Base domain — health check
agents.theagentpost.co {
    tls {
        dns cloudflare {env.CLOUDFLARE_API_TOKEN}
    }
    respond "ok" 200
}
CADDY

# --- Caddy systemd service ---
cat > /etc/systemd/system/caddy.service <<EOF
[Unit]
Description=Caddy
After=network.target

[Service]
Type=notify
ExecStart=/usr/bin/caddy run --config /opt/agentpost/Caddyfile --adapter caddyfile
ExecReload=/usr/bin/caddy reload --config /opt/agentpost/Caddyfile --adapter caddyfile
Environment=CLOUDFLARE_API_TOKEN=${CLOUDFLARE_API_TOKEN}
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable caddy
systemctl start caddy

# --- Copy provisioning API ---
echo "=== Setting up provisioning API ==="
cp -r /opt/agentpost-deploy/provisioning/* /opt/agentpost/provisioning/
cd /opt/agentpost/provisioning
npm install

# --- Provisioning API systemd service ---
cat > /etc/systemd/system/agentpost-provisioning.service <<EOF
[Unit]
Description=AgentPost Provisioning API
After=network.target docker.service

[Service]
Type=simple
WorkingDirectory=/opt/agentpost/provisioning
ExecStart=/usr/bin/node dist/index.js
Environment=PORT=3500
Environment=PROVISIONING_API_SECRET=${PROVISIONING_API_SECRET}
Environment=RESEND_API_KEY=${RESEND_API_KEY}
Environment=CLOUDFLARE_API_TOKEN=${CLOUDFLARE_API_TOKEN}
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable agentpost-provisioning
systemctl start agentpost-provisioning

# --- Caddy route for provisioning API ---
# api.agents.theagentpost.co → localhost:3500
caddy reverse-proxy --from api.agents.theagentpost.co --to localhost:3500 &>/dev/null || true

# --- Firewall ---
echo "=== Configuring firewall ==="
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

# --- Health check cron ---
echo "=== Setting up health check cron ==="
cp /opt/agentpost-deploy/health-check.sh /opt/agentpost/health-check.sh
chmod +x /opt/agentpost/health-check.sh
(crontab -l 2>/dev/null; echo "*/5 * * * * /opt/agentpost/health-check.sh") | crontab -

echo "=== Setup complete ==="
echo "Provisioning API running on localhost:3500"
echo "Caddy running on ports 80/443"
