#!/usr/bin/env bash
set -Eeuo pipefail

# Permanently removes the road database, the downloaded PBF, and the OSRM graph from this machine.
# The repository and .env are left alone.

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${1:-${REPO_DIR}/.env}"
[[ -r "$ENV_FILE" ]] || { echo "Missing configuration: $ENV_FILE" >&2; exit 1; }

set -a
# shellcheck source=/dev/null
source "$ENV_FILE"
set +a

: "${DB_DB:=roads}"
: "${DB_PORT:=5432}"
: "${DB_USER:=roads_api}"
: "${ROADS_DB_USER:=roads_import}"
: "${ROADS_HOME:=/srv/road-network}"
: "${OSRM_HOME:=/srv/osrm}"

[[ $EUID -eq 0 ]] || { echo "Run with sudo: sudo bash scripts/reset-all.sh" >&2; exit 1; }

echo "This permanently deletes:"
echo "  - PostgreSQL database \"$DB_DB\" and roles \"$ROADS_DB_USER\", \"$DB_USER\""
echo "  - $ROADS_HOME (downloaded PBF and credentials)"
echo "  - $OSRM_HOME (routing graph)"
echo
read -r -p "Type 'delete road network' to confirm: " confirmation
[[ "$confirmation" == "delete road network" ]] || { echo "Aborted."; exit 1; }

docker rm -f bpo-osrm >/dev/null 2>&1 || true
sudo -u postgres psql -X -p "$DB_PORT" -c "DROP DATABASE IF EXISTS \"$DB_DB\"" || true
sudo -u postgres psql -X -p "$DB_PORT" -c "DROP ROLE IF EXISTS \"$ROADS_DB_USER\"" || true
sudo -u postgres psql -X -p "$DB_PORT" -c "DROP ROLE IF EXISTS \"$DB_USER\"" || true
rm -rf "$ROADS_HOME" "$OSRM_HOME"
userdel road-network 2>/dev/null || true

echo "Road network installation removed."
