#!/usr/bin/env bash
set -Eeuo pipefail

# Full server install: backend runtime, PostGIS road import, and the OSRM matching graph.
# Ubuntu 24.04. Run with sudo. Safe to re-run -- each stage detects work it has already done.

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${1:-${REPO_DIR}/.env}"

[[ $EUID -eq 0 ]] || { echo "Run with sudo: sudo bash scripts/setup-all.sh" >&2; exit 1; }

if [[ ! -f "$ENV_FILE" ]]; then
  cp "$REPO_DIR/.env.example" "$ENV_FILE"
  token="$(openssl rand -hex 32)"
  sed -i \
    -e "s|^ROAD_INDEX_ADMIN_TOKEN=.*|ROAD_INDEX_ADMIN_TOKEN=$token|" \
    -e "s|^DB_PASS=.*|DB_PASS=$(openssl rand -hex 16)|" \
    -e "s|^ROADS_DB_PASS=.*|ROADS_DB_PASS=$(openssl rand -hex 16)|" \
    "$ENV_FILE"
  chmod 600 "$ENV_FILE" 2>/dev/null || true
  echo "Generated $ENV_FILE with random secrets. Review it now and make any changes you need."
  read -r -p "Press Enter to continue with the install... "
fi

echo "=== [1/3] Backend runtime ==="
bash "$REPO_DIR/scripts/setup-backend.sh"

echo "=== [2/3] PostGIS road network ==="
bash "$REPO_DIR/scripts/setup-road-network.sh" "$ENV_FILE"

echo "=== [3/3] OSRM matching graph ==="
# Only /api/match needs this. A missing OSRM leaves /api/roads and /api/snap fully working, and
# /api/health reports "degraded" rather than failing -- so a Docker-less server is not a dead end.
if bash "$REPO_DIR/scripts/build-osrm.sh" "$ENV_FILE"; then
  echo "OSRM graph ready."
else
  echo "OSRM graph build failed or was skipped. Road extraction and snapping still work;" >&2
  echo "POST /api/match will report map matching as unavailable until it is built." >&2
fi

echo
echo "Install complete. Start everything with: bash scripts/run-stack.sh"
