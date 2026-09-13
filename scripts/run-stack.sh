#!/usr/bin/env bash
set -Eeuo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${1:-${REPO_DIR}/.env}"
cd "$REPO_DIR"

[[ -r "$ENV_FILE" ]] || { echo "Missing configuration: $ENV_FILE" >&2; exit 1; }
set -a
# shellcheck source=/dev/null
source "$ENV_FILE"
set +a
redis-cli -u "${REDIS_URL:-redis://127.0.0.1:6379/1}" ping | grep -qx PONG || {
  echo "Redis is not running" >&2
  exit 1
}

PIDS=()
cleanup() {
  trap - EXIT INT TERM
  docker rm -f bpo-osrm >/dev/null 2>&1 || true
  ((${#PIDS[@]} == 0)) || kill "${PIDS[@]}" 2>/dev/null || true
  wait "${PIDS[@]}" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# OSRM is optional: the stack stays useful without it, so a failure here is logged rather than
# fatal. See scripts/setup-all.sh for the same reasoning.
if [[ -d "${OSRM_HOME:-/srv/osrm}/data" ]]; then
  bash "$REPO_DIR/scripts/run-osrm.sh" "$ENV_FILE" &
  PIDS+=("$!")
else
  echo "No OSRM graph found; starting without map matching." >&2
fi

npm start &
PIDS+=("$!")

# The worker shells out to update-roads.sh, which reads the import role's .pgpass (mode 0600,
# owned by road-network). Running it as the invoking user would fail there with a bare
# "no password supplied" long after the job was queued.
sudo -u road-network bash -c "set -a; source '$ENV_FILE'; cd '$REPO_DIR'; exec node workers/roadIndexUpdateWorker.js" &
PIDS+=("$!")

echo "API, update worker${OSRM_HOME:+, and OSRM} started. Press Ctrl+C to stop them."
wait -n "${PIDS[@]}"
echo "A service stopped; shutting down the remaining services." >&2
exit 1
