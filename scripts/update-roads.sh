#!/usr/bin/env bash
set -Eeuo pipefail

# Applies pending Geofabrik diffs to the PostGIS roads table. Called by the BullMQ update worker,
# and safe to run by hand. Does nothing when the local database is already current.

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${1:-${REPO_DIR}/.env}"
[[ -r "$ENV_FILE" ]] || { echo "Missing configuration: $ENV_FILE" >&2; exit 1; }

set -a
# shellcheck source=/dev/null
source "$ENV_FILE"
set +a

: "${DB_HOST:=127.0.0.1}"
: "${DB_PORT:=5432}"
: "${DB_DB:=roads}"
: "${ROADS_DB_USER:=roads_import}"
: "${ROADS_PGPASSFILE:=/srv/road-network/import.pgpass}"
: "${OSM2PGSQL_CACHE_MB:=2000}"
: "${OSM2PGSQL_PROCESSES:=2}"

export PGPASSFILE="$ROADS_PGPASSFILE"

# Everything after "--" is handed to osm2pgsql itself, and it has to describe the same output as
# the original import -- osm2pgsql-replication runs osm2pgsql in append mode, and an append with a
# different style would write the wrong columns.
osm2pgsql-replication update \
  --database "$DB_DB" --host "$DB_HOST" --port "$DB_PORT" --user "$ROADS_DB_USER" \
  -- \
  --output=flex \
  --style "$REPO_DIR/osm2pgsql/roads.lua" \
  --cache "$OSM2PGSQL_CACHE_MB" \
  --number-processes "$OSM2PGSQL_PROCESSES"

# Append updates keep the indexes current but not the planner statistics, and a stale row estimate
# is enough to turn the /api/snap nearest-neighbour scan back into a sequential one.
psql -X -v ON_ERROR_STOP=1 -h "$DB_HOST" -p "$DB_PORT" -U "$ROADS_DB_USER" -d "$DB_DB" \
  -c "ANALYZE roads"

echo "Road network update complete."
