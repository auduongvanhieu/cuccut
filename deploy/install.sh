#!/usr/bin/env bash
# One-time server setup for cuccut.coffeesos.online (idempotent). Run as root:
#   sudo bash /root/session_manager_workspaces/cuccut/deploy/install.sh
# With a Groq key for subtitles:
#   sudo GROQ_API_KEY=gsk_... bash /root/session_manager_workspaces/cuccut/deploy/install.sh
# Afterwards, deploys need no sudo: bash deploy/deploy.sh
set -euo pipefail

DOMAIN=cuccut.coffeesos.online
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
WEB_ROOT="/var/www/$DOMAIN"
DEPLOY_USER="${DEPLOY_USER:-sm}"
DATA_DIR=/var/lib/cuccut
ENV_FILE=/etc/cuccut/cuccut.env

[ "$(id -u)" -eq 0 ] || { echo "Run as root (sudo)."; exit 1; }
[ -f "$PROJECT_DIR/web/dist/index.html" ] || { echo "web/dist not found. Run 'bash deploy/deploy.sh' first."; exit 1; }

echo "==> Web root $WEB_ROOT (owned by $DEPLOY_USER so future deploys need no sudo)"
mkdir -p "$WEB_ROOT"
rsync -a --delete "$PROJECT_DIR/web/dist/" "$WEB_ROOT/"
chown -R "$DEPLOY_USER:$DEPLOY_USER" "$WEB_ROOT"

echo "==> AI proxy data dir $DATA_DIR and env file $ENV_FILE"
mkdir -p "$DATA_DIR" /etc/cuccut
chown "$DEPLOY_USER:$DEPLOY_USER" "$DATA_DIR"
[ -f "$ENV_FILE" ] || install -m 640 -o root -g "$DEPLOY_USER" "$PROJECT_DIR/deploy/cuccut.env.example" "$ENV_FILE"
if [ -n "${GROQ_API_KEY:-}" ]; then
  sed -i "s|^GROQ_API_KEY=.*|GROQ_API_KEY=$GROQ_API_KEY|" "$ENV_FILE"
fi
grep -q '^GROQ_API_KEY=.\+' "$ENV_FILE" || echo "    NOTE: GROQ_API_KEY is empty in $ENV_FILE -> subtitles stay disabled until you set it and restart cuccut-ai."

echo "==> systemd service cuccut-ai"
install -m 644 "$PROJECT_DIR/deploy/cuccut-ai.service" /etc/systemd/system/cuccut-ai.service
systemctl daemon-reload
systemctl enable --now cuccut-ai
systemctl restart cuccut-ai
sleep 1
curl -fsS http://127.0.0.1:7820/api/ai/health >/dev/null && echo "    AI proxy healthy" || { echo "    AI proxy not responding; see: journalctl -u cuccut-ai -n 50"; exit 1; }

echo "==> sudoers: let $DEPLOY_USER restart the AI proxy without a password"
SUDOERS=/etc/sudoers.d/cuccut-deploy
echo "$DEPLOY_USER ALL=(root) NOPASSWD: /usr/bin/systemctl restart cuccut-ai, /usr/bin/systemctl status cuccut-ai, /usr/bin/journalctl -u cuccut-ai *" > "$SUDOERS"
chmod 440 "$SUDOERS"
visudo -cf "$SUDOERS" >/dev/null

echo "==> nginx config + TLS"
if [ ! -d "/etc/letsencrypt/live/$DOMAIN" ]; then
  # Plain HTTP block first so certbot can answer the HTTP-01 challenge.
  cat > "/etc/nginx/conf.d/$DOMAIN.conf" <<NGINX
server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN;
    root $WEB_ROOT;
    location / { try_files \$uri \$uri/ /index.html; }
}
NGINX
  nginx -t && systemctl reload nginx
  certbot certonly --nginx -d "$DOMAIN" --non-interactive --agree-tos \
    --email "${CERTBOT_EMAIL:-auduongvanhieu@gmail.com}" || {
      echo "certbot failed. Check the DNS record for $DOMAIN, then re-run this script."
      exit 1
    }
fi
install -m 644 "$PROJECT_DIR/deploy/nginx/$DOMAIN.conf" "/etc/nginx/conf.d/$DOMAIN.conf"
nginx -t
systemctl reload nginx

echo "==> Done: https://$DOMAIN"
