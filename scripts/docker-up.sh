#!/usr/bin/env bash
set -Eeuo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$REPO_DIR/.env"
HOST_PORT=5003

usage() {
  echo "Usage: bash scripts/docker-up.sh [--port HOST_PORT]"
}

while (( $# > 0 )); do
  case "$1" in
    -p|--port)
      [[ $# -ge 2 ]] || { echo "Missing value after $1" >&2; usage; exit 2; }
      HOST_PORT=$2
      shift 2
      ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage; exit 2 ;;
  esac
done

[[ "$HOST_PORT" =~ ^[0-9]+$ ]] && (( HOST_PORT >= 1 && HOST_PORT <= 65535 )) || {
  echo "Invalid host port: $HOST_PORT" >&2
  exit 2
}
export HOST_PORT

if [[ ! -f "$ENV_FILE" ]]; then
  cp "$REPO_DIR/.env.example" "$ENV_FILE"
  sed -i \
    -e "s|^ROAD_INDEX_ADMIN_TOKEN=.*|ROAD_INDEX_ADMIN_TOKEN=$(openssl rand -hex 32)|" \
    -e 's|^DB_PASS=.*|DB_PASS=roads_api|' \
    -e 's|^ROADS_DB_PASS=.*|ROADS_DB_PASS=roads_import|' \
    "$ENV_FILE"
  chmod 600 "$ENV_FILE" 2>/dev/null || true
  echo "Generated $ENV_FILE. Review it now and make any changes you need."
  read -r -p "Press Enter to build and start the containers... "
fi

set -a
# shellcheck source=/dev/null
source "$ENV_FILE"
set +a

READY_URL="http://127.0.0.1:$HOST_PORT/api/health"
TIMEOUT_SECONDS="${DOCKER_STARTUP_TIMEOUT_SECONDS:-28800}"
POLL_SECONDS=5

cd "$REPO_DIR"
docker compose up --build -d

echo "Containers are running in the background."
echo "Waiting for the API to become ready at $READY_URL ..."
echo "The first start imports Bangladesh into PostGIS, then builds the OSRM graph; both are slow."

started_at=$(date +%s)
last_log_at=0
while true; do
  if curl -fsS "$READY_URL" >/dev/null 2>&1; then
    echo
    echo "Bangladesh road-network backend is ready."
    echo "API: http://127.0.0.1:$HOST_PORT"
    echo
    echo "Snap a point to the nearest road:"
    echo "curl -sS 'http://127.0.0.1:$HOST_PORT/api/snap?lat=23.8103&lon=90.4125&radius=100' | jq"
    echo
    # The API reports healthy before osrm-build finishes -- that is deliberate, since snapping
    # works without it. Map matching turns on once "osrm" shows as up.
    echo "Map matching becomes available once /api/health reports dependencies.osrm as \"up\"."
    echo
    echo "Status: docker compose ps"
    echo "Logs: docker compose logs -f"
    echo "Stop: docker compose down"
    exit 0
  fi

  container_id=$(docker compose ps -q road-network)
  if [[ -z "$container_id" ]] || [[ "$(docker inspect -f '{{.State.Running}}' "$container_id" 2>/dev/null)" != true ]]; then
    echo "The road-network container stopped before the API became ready." >&2
    docker compose logs --tail=100 >&2
    exit 1
  fi

  elapsed=$(( $(date +%s) - started_at ))
  if (( elapsed >= TIMEOUT_SECONDS )); then
    echo "Timed out after ${TIMEOUT_SECONDS}s waiting for readiness." >&2
    echo "The containers remain running. Inspect them with: docker compose logs -f" >&2
    exit 1
  fi

  if (( elapsed - last_log_at >= 30 )); then
    echo
    echo "Still starting (${elapsed}s elapsed). Recent logs:"
    docker compose logs --tail=8 --no-color road-network
    last_log_at=$elapsed
  fi

  sleep "$POLL_SECONDS"
done
