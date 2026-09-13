#!/usr/bin/env bash
set -Eeuo pipefail

# Builds the OSRM routing graph used by POST /api/match.
#
# OSRM runs from its official image rather than being compiled here on purpose: it is not packaged
# for Ubuntu, and a source build pulls in boost/tbb/lua and is version-sensitive against whatever
# the distribution ships. The image is the configuration upstream actually tests.
#
# This is a full rebuild every time -- OSRM compiles its graph from a PBF and has no incremental
# update path, which is why ROAD_INDEX_OSRM_REBUILD_ENABLED defaults to false.

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${1:-${REPO_DIR}/.env}"
[[ -r "$ENV_FILE" ]] || { echo "Missing configuration: $ENV_FILE" >&2; exit 1; }

set -a
# shellcheck source=/dev/null
source "$ENV_FILE"
set +a

: "${OSRM_HOME:=/srv/osrm}"
: "${OSRM_VERSION:=v5.27.1}"
: "${OSRM_PROFILE:=foot}"
: "${ROADS_HOME:=/srv/road-network}"
: "${OSM_PBF_URL:=https://download.geofabrik.de/asia/bangladesh-latest.osm.pbf}"
: "${OSM_PBF_DIR:=${ROADS_HOME}/data}"

command -v docker >/dev/null 2>&1 || {
  echo "Docker is required to build the OSRM graph. Install it, or set" >&2
  echo "ROAD_INDEX_OSRM_REBUILD_ENABLED=false and skip map matching." >&2
  exit 1
}

IMAGE="ghcr.io/project-osrm/osrm-backend:${OSRM_VERSION}"
PBF_NAME="$(basename "$OSM_PBF_URL")"
BASE_NAME="${PBF_NAME%%.osm.pbf}"
DATA_DIR="$OSRM_HOME/data"

mkdir -p "$DATA_DIR"

if [[ ! -f "$DATA_DIR/$PBF_NAME" ]]; then
  # Reuse the copy setup-road-network.sh already downloaded when it is there. A hard link keeps
  # the second gigabyte off the disk; it falls back to a copy across filesystems.
  if [[ -f "$OSM_PBF_DIR/$PBF_NAME" ]]; then
    ln "$OSM_PBF_DIR/$PBF_NAME" "$DATA_DIR/$PBF_NAME" 2>/dev/null \
      || cp "$OSM_PBF_DIR/$PBF_NAME" "$DATA_DIR/$PBF_NAME"
  else
    wget --continue -O "$DATA_DIR/$PBF_NAME" "$OSM_PBF_URL"
  fi
fi

run_osrm() {
  docker run --rm -v "$DATA_DIR:/data" "$IMAGE" "$@"
}

echo "[1/3] osrm-extract (profile: $OSRM_PROFILE)"
run_osrm osrm-extract -p "/opt/${OSRM_PROFILE}.lua" "/data/${PBF_NAME}"

# MLD (multi-level Dijkstra) partition/customize, matching the --algorithm mld that run-osrm.sh
# starts osrm-routed with. The two must agree or osrm-routed refuses to load the graph.
echo "[2/3] osrm-partition"
run_osrm osrm-partition "/data/${BASE_NAME}.osrm"

echo "[3/3] osrm-customize"
run_osrm osrm-customize "/data/${BASE_NAME}.osrm"

echo "OSRM graph built in $DATA_DIR (${BASE_NAME}.osrm)."
