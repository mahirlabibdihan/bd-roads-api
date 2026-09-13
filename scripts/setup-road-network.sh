#!/usr/bin/env bash
set -Eeuo pipefail

# Imports the Bangladesh road network into PostGIS. Ubuntu 24.04, run with sudo on the server.
# Safe to re-run: a completed import is detected and skipped unless --force is passed.

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${REPO_DIR}/.env"
FORCE=false

while (( $# > 0 )); do
  case "$1" in
    --force) FORCE=true; shift ;;
    -*) echo "Unknown option: $1" >&2; exit 2 ;;
    *) ENV_FILE="$1"; shift ;;
  esac
done

[[ -r "$ENV_FILE" ]] || { echo "Missing configuration: $ENV_FILE" >&2; exit 1; }
set -a
# Preserve the shared-volume path supplied by Docker Compose.
COMPOSE_OSM_PBF_DIR="${OSM_PBF_DIR:-}"
# shellcheck source=/dev/null
source "$ENV_FILE"
if [[ -n "$COMPOSE_OSM_PBF_DIR" ]]; then
  OSM_PBF_DIR="$COMPOSE_OSM_PBF_DIR"
fi
set +a

: "${DB_HOST:=127.0.0.1}"
: "${DB_PORT:=5432}"
: "${DB_DB:=roads}"
: "${DB_USER:=roads_api}"
: "${DB_PASS:?Set DB_PASS in .env}"
: "${DB_PGPASSFILE:=/srv/road-network/.pgpass}"
: "${DB_ADMIN_USER:=postgres}"
: "${ROADS_DB_USER:=roads_import}"
: "${ROADS_DB_PASS:?Set ROADS_DB_PASS in .env}"
: "${ROADS_PGPASSFILE:=/srv/road-network/import.pgpass}"
: "${ROADS_HOME:=/srv/road-network}"
: "${OSM_PBF_URL:=https://download.geofabrik.de/asia/bangladesh-latest.osm.pbf}"
: "${OSM_REPLICATION_URL:=https://download.geofabrik.de/asia/bangladesh-updates}"
: "${OSM2PGSQL_CACHE_MB:=2000}"
: "${OSM2PGSQL_PROCESSES:=2}"
# Where the source PBF lives. Overridden in Compose to a volume the OSRM graph build also mounts,
# so Bangladesh is downloaded once rather than once per service.
: "${OSM_PBF_DIR:=${ROADS_HOME}/data}"

[[ $EUID -eq 0 ]] || { echo "Run with sudo: sudo bash scripts/setup-road-network.sh" >&2; exit 1; }
for role in "$DB_ADMIN_USER" "$ROADS_DB_USER" "$DB_USER"; do
  [[ "$role" =~ ^[a-zA-Z_][a-zA-Z0-9_]*$ ]] || { echo "Invalid DB role: $role" >&2; exit 1; }
done
[[ "$DB_DB" =~ ^[a-zA-Z_][a-zA-Z0-9_]*$ ]] || { echo "Invalid database name: $DB_DB" >&2; exit 1; }

IS_LOCAL_DB=false
if [[ "$DB_HOST" == 127.0.0.1 || "$DB_HOST" == localhost ]]; then
  IS_LOCAL_DB=true
fi

PBF_FILE="$OSM_PBF_DIR/$(basename "$OSM_PBF_URL")"
MARKER="$ROADS_HOME/.import-complete"

sql_literal() { printf "%s" "${1//\'/\'\'}"; }

admin_psql() {
  if [[ "$IS_LOCAL_DB" == true ]]; then
    sudo -u postgres psql -X -v ON_ERROR_STOP=1 -p "$DB_PORT" "$@"
  else
    PGPASSWORD="${DB_ADMIN_PASS:-}" psql -X -v ON_ERROR_STOP=1 \
      -h "$DB_HOST" -p "$DB_PORT" -U "$DB_ADMIN_USER" -d "${DB_ADMIN_DB:-postgres}" "$@"
  fi
}

ensure_role() {
  local role=$1 password=$2 escaped
  escaped=$(sql_literal "$password")
  if ! admin_psql -Atc "SELECT 1 FROM pg_roles WHERE rolname='${role}'" | grep -qx 1; then
    printf 'CREATE ROLE "%s" LOGIN PASSWORD '\''%s'\'';\n' "$role" "$escaped" | admin_psql
  else
    printf 'ALTER ROLE "%s" PASSWORD '\''%s'\'';\n' "$role" "$escaped" | admin_psql
  fi
}

write_pgpass() {
  local file=$1 owner=$2 user=$3 password=$4
  install -m 0600 -o "$owner" -g "$owner" /dev/null "$file"
  printf '%s:%s:%s:%s:%s\n' "$DB_HOST" "$DB_PORT" "$DB_DB" "$user" "$password" > "$file"
  chown "$owner:$owner" "$file"
  chmod 0600 "$file"
}

echo "[1/7] Installing system packages"
apt update
# python3-pyosmium and python3-psycopg2 are what osm2pgsql-replication imports at runtime; the
# osm2pgsql package does not pull them in, and the failure only shows up at the first update.
apt install -y postgresql postgresql-postgis postgresql-postgis-scripts osm2pgsql \
  python3-pyosmium python3-psycopg2 curl wget jq ca-certificates

echo "[2/7] Creating service user, roles, and database"
if [[ "$IS_LOCAL_DB" == true ]] && command -v pg_lsclusters >/dev/null 2>&1; then
  LOCAL_DB_PORT=$(pg_lsclusters --no-header | awk '$4 == "online" { print $3; exit }')
  if [[ -n "$LOCAL_DB_PORT" && "$DB_PORT" != "$LOCAL_DB_PORT" ]]; then
    echo "Configured DB_PORT=$DB_PORT, but this PostgreSQL cluster uses $LOCAL_DB_PORT." >&2
    echo "Use a separate environment file with DB_PORT=$LOCAL_DB_PORT." >&2
    exit 1
  fi
fi

id -u road-network >/dev/null 2>&1 || useradd --system --create-home --home-dir "$ROADS_HOME" --shell /bin/bash road-network
install -d -o road-network -g road-network "$ROADS_HOME" "$ROADS_HOME/log" "$OSM_PBF_DIR"

ensure_role "$ROADS_DB_USER" "$ROADS_DB_PASS"
ensure_role "$DB_USER" "$DB_PASS"
if ! admin_psql -Atc "SELECT 1 FROM pg_database WHERE datname='${DB_DB}'" | grep -qx 1; then
  admin_psql -c "CREATE DATABASE \"$DB_DB\" OWNER \"$ROADS_DB_USER\""
fi
admin_psql -d "$DB_DB" -c "CREATE EXTENSION IF NOT EXISTS postgis"
# osm2pgsql writes into public; the import role owns it so it can create the roads table itself.
admin_psql -d "$DB_DB" -c "ALTER SCHEMA public OWNER TO \"$ROADS_DB_USER\""

write_pgpass "$ROADS_PGPASSFILE" road-network "$ROADS_DB_USER" "$ROADS_DB_PASS"
write_pgpass "$DB_PGPASSFILE" road-network "$DB_USER" "$DB_PASS"

if [[ -f "$MARKER" && "$FORCE" != true ]]; then
  echo "Road network already imported ($MARKER). Re-run with --force to import again."
  exit 0
fi

echo "[3/7] Downloading $OSM_PBF_URL"
sudo -u road-network wget --continue -O "$PBF_FILE" "$OSM_PBF_URL"
if sudo -u road-network wget -q -O "$PBF_FILE.md5" "$OSM_PBF_URL.md5"; then
  ( cd "$(dirname "$PBF_FILE")" && sudo -u road-network md5sum -c "$(basename "$PBF_FILE").md5" ) \
    || { echo "PBF checksum mismatch; delete $PBF_FILE and re-run." >&2; exit 1; }
else
  echo "Warning: could not fetch the Geofabrik checksum; continuing without verification." >&2
fi

echo "[4/7] Importing roads with osm2pgsql (this takes a while)"
# --slim keeps the node/way middle tables, which osm2pgsql-replication needs to apply later diffs.
# Without it the only way to refresh is a full re-import.
sudo -u road-network env PGPASSFILE="$ROADS_PGPASSFILE" osm2pgsql \
  --create --slim \
  --output=flex \
  --style "$REPO_DIR/osm2pgsql/roads.lua" \
  --cache "$OSM2PGSQL_CACHE_MB" \
  --number-processes "$OSM2PGSQL_PROCESSES" \
  --database "$DB_DB" --host "$DB_HOST" --port "$DB_PORT" --user "$ROADS_DB_USER" \
  "$PBF_FILE"

echo "[5/7] Creating API indexes"
sudo -u road-network env PGPASSFILE="$ROADS_PGPASSFILE" psql -X -v ON_ERROR_STOP=1 \
  -h "$DB_HOST" -p "$DB_PORT" -U "$ROADS_DB_USER" -d "$DB_DB" -f "$REPO_DIR/sql/indexes.sql"

echo "[6/7] Granting read-only access to $DB_USER"
bash "$REPO_DIR/scripts/grant-roads-access.sh" "$ENV_FILE"

echo "[7/7] Initializing replication from $OSM_REPLICATION_URL"
sudo -u road-network env PGPASSFILE="$ROADS_PGPASSFILE" osm2pgsql-replication init \
  --database "$DB_DB" --host "$DB_HOST" --port "$DB_PORT" --user "$ROADS_DB_USER" \
  --server "$OSM_REPLICATION_URL"

touch "$MARKER"
chown road-network:road-network "$MARKER"
echo "Road network import complete."
