#!/usr/bin/env bash
set -Eeuo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${1:-${REPO_DIR}/.env}"
[[ -r "$ENV_FILE" ]] || { echo "Missing configuration: $ENV_FILE" >&2; exit 1; }

set -a
# shellcheck source=/dev/null
source "$ENV_FILE"
set +a

: "${OSRM_HOME:=/srv/osrm}"
: "${OSRM_VERSION:=v5.27.1}"
: "${OSRM_LISTEN_IP:=127.0.0.1}"
: "${OSRM_LISTEN_PORT:=5010}"
: "${OSRM_MAX_MATCHING_SIZE:=1000}"
: "${OSM_PBF_URL:=https://download.geofabrik.de/asia/bangladesh-latest.osm.pbf}"

PBF_NAME="$(basename "$OSM_PBF_URL")"
BASE_NAME="${PBF_NAME%%.osm.pbf}"
DATA_DIR="$OSRM_HOME/data"

[[ -f "$DATA_DIR/${BASE_NAME}.osrm.mldgr" ]] || {
  echo "No OSRM graph in $DATA_DIR. Run: bash scripts/build-osrm.sh" >&2
  exit 1
}

# --max-matching-size raises OSRM's default 100-coordinate cap on /match. A recorded beat boundary
# walk is routinely longer than that, and the service validates the same limit before calling out.
exec docker run --rm --name bpo-osrm \
  -p "${OSRM_LISTEN_IP}:${OSRM_LISTEN_PORT}:5000" \
  -v "$DATA_DIR:/data" \
  "ghcr.io/project-osrm/osrm-backend:${OSRM_VERSION}" \
  osrm-routed --algorithm mld --max-matching-size "$OSRM_MAX_MATCHING_SIZE" "/data/${BASE_NAME}.osrm"
