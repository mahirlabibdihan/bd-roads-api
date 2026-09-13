#!/usr/bin/env bash
set -Eeuo pipefail

# Installs Node.js 22, Redis, and the npm packages. Does not touch PostgreSQL or the road data.

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
[[ $EUID -eq 0 ]] || { echo "Run with sudo: sudo bash scripts/setup-backend.sh" >&2; exit 1; }

apt update
apt install -y curl ca-certificates redis-server
if ! command -v node >/dev/null 2>&1 || [[ "$(node --version | cut -d. -f1 | tr -d v)" -lt 22 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt install -y nodejs
fi

systemctl enable --now redis-server || service redis-server start

cd "$REPO_DIR"
if [[ -f package-lock.json ]]; then
  npm ci --omit=dev
else
  npm install --omit=dev
fi

echo "Backend dependencies installed (node $(node --version))."
