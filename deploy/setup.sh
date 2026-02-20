#!/usr/bin/env bash
#
# ShipKit Droplet Deployment Script
#
# Usage (run from local machine):
#   bash deploy/setup.sh              # First-time setup + deploy
#   bash deploy/setup.sh --update     # Update existing deployment
#
# Prerequisites:
#   - SSH access to mcloud88.com as readmigo user
#   - Nginx config installed (requires root, one-time)
#   - Cloudflare DNS: shipkit.mcloud88.com → Droplet IP (proxied)

set -euo pipefail

REMOTE_HOST="readmigo@mcloud88.com"
REMOTE_DIR="/home/readmigo/shipkit"
REPO_URL="https://github.com/readmigo/shipkit.git"

# ─── Colors ────────────────────────────────────────────────────────────
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info()  { echo -e "${GREEN}[INFO]${NC} $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }

# ─── First-time setup ─────────────────────────────────────────────────
setup_dirs() {
  info "Creating directories..."
  ssh "$REMOTE_HOST" "mkdir -p ~/.shipkit/logs"
}

clone_or_pull() {
  info "Syncing code..."
  ssh "$REMOTE_HOST" bash -s <<'SCRIPT'
    set -euo pipefail
    if [ -d ~/shipkit/.git ]; then
      cd ~/shipkit
      git fetch origin
      git reset --hard origin/main
    else
      git clone https://github.com/readmigo/shipkit.git ~/shipkit
    fi
SCRIPT
}

install_deps() {
  info "Installing dependencies..."
  ssh "$REMOTE_HOST" "cd $REMOTE_DIR && pnpm install --frozen-lockfile --prod=false"
}

build() {
  info "Building TypeScript..."
  ssh "$REMOTE_HOST" "cd $REMOTE_DIR && pnpm build"
}

start_pm2() {
  info "Starting/reloading PM2..."
  ssh "$REMOTE_HOST" bash -s <<'SCRIPT'
    set -euo pipefail
    cd ~/shipkit
    if pm2 describe shipkit-web > /dev/null 2>&1; then
      pm2 reload deploy/ecosystem.config.cjs
    else
      pm2 start deploy/ecosystem.config.cjs
    fi
    pm2 save
SCRIPT
}

show_status() {
  info "Deployment complete. Status:"
  ssh "$REMOTE_HOST" "pm2 list"
  echo ""
  info "MCP endpoint: https://shipkit.mcloud88.com/mcp"
  info "Dashboard:    https://shipkit.mcloud88.com/"
  info "Health check: https://shipkit.mcloud88.com/api/health"
}

# ─── Nginx setup (requires root, one-time) ────────────────────────────
setup_nginx() {
  warn "Nginx config requires root access. Run manually:"
  echo ""
  echo "  scp deploy/nginx/shipkit.mcloud88.com.conf root@mcloud88.com:/etc/nginx/sites-available/"
  echo "  ssh root@mcloud88.com 'ln -sf /etc/nginx/sites-available/shipkit.mcloud88.com.conf /etc/nginx/sites-enabled/ && nginx -t && systemctl reload nginx'"
  echo ""
}

# ─── Main ──────────────────────────────────────────────────────────────
main() {
  local update_only=false
  if [[ "${1:-}" == "--update" ]]; then
    update_only=true
  fi

  if [ "$update_only" = false ]; then
    info "=== ShipKit First-Time Setup ==="
    setup_dirs
    setup_nginx
  else
    info "=== ShipKit Update ==="
  fi

  clone_or_pull
  install_deps
  build
  start_pm2
  show_status
}

main "$@"
