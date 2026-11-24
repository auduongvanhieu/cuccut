#!/usr/bin/env bash
# Build the PWA and publish it. Works without a password once install.sh has run.
set -euo pipefail
export PATH="$HOME/sdk/node/bin:$PATH"
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
WEB_ROOT="/var/www/cuccut.coffeesos.online"

cd "$PROJECT_DIR/web"
echo "==> build"
npm run build

if [ -w "$WEB_ROOT" ]; then
  rsync -a --delete dist/ "$WEB_ROOT/"
  echo "==> published to $WEB_ROOT"
else
  echo "$WEB_ROOT is not writable. Run once as root: sudo bash $PROJECT_DIR/deploy/install.sh"
  exit 1
fi

if systemctl is-enabled cuccut-ai >/dev/null 2>&1; then
  sudo -n systemctl restart cuccut-ai && echo "==> cuccut-ai restarted" || echo "Could not restart cuccut-ai (run: sudo systemctl restart cuccut-ai)"
else
  echo "cuccut-ai service not installed yet. Run once as root: sudo bash $PROJECT_DIR/deploy/install.sh"
fi
