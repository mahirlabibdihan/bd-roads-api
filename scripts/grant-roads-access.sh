#!/usr/bin/env bash
set -Eeuo pipefail

# Grants the read-only API role SELECT on the roads table and on the osm2pgsql replication state.
# Only grants -- it never creates or alters roles -- so it is safe to run against an already
# provisioned database, including one restored from a snapshot taken before a grant was added here.

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
: "${DB_USER:=roads_api}"
: "${DB_ADMIN_USER:=postgres}"

for role in "$DB_ADMIN_USER" "$DB_USER"; do
  [[ "$role" =~ ^[a-zA-Z_][a-zA-Z0-9_]*$ ]] || { echo "Invalid DB role: $role" >&2; exit 1; }
done
[[ "$DB_DB" =~ ^[a-zA-Z_][a-zA-Z0-9_]*$ ]] || { echo "Invalid database name: $DB_DB" >&2; exit 1; }

run_psql() {
  if [[ "$DB_HOST" == 127.0.0.1 || "$DB_HOST" == localhost ]]; then
    sudo -u postgres psql -X -v ON_ERROR_STOP=1 -p "$DB_PORT" -d "$DB_DB" "$@"
  else
    PGPASSWORD="${DB_ADMIN_PASS:-}" psql -X -v ON_ERROR_STOP=1 \
      -h "$DB_HOST" -p "$DB_PORT" -U "$DB_ADMIN_USER" -d "$DB_DB" "$@"
  fi
}

run_psql -c "GRANT CONNECT ON DATABASE \"$DB_DB\" TO \"$DB_USER\""
run_psql -c "GRANT USAGE ON SCHEMA public TO \"$DB_USER\""
run_psql -c "GRANT SELECT ON TABLE roads TO \"$DB_USER\""

# osm2pgsql 1.9+ records replication state in osm2pgsql_properties; older builds used
# osm2pgsql_replication_status. Grant on whichever is actually present rather than assuming.
for table in osm2pgsql_properties osm2pgsql_replication_status; do
  if [[ "$(run_psql -Atc "SELECT to_regclass('public.$table') IS NOT NULL")" == "t" ]]; then
    run_psql -c "GRANT SELECT ON TABLE $table TO \"$DB_USER\""
    echo "Granted SELECT on $table."
  fi
done

echo "Granted read-only road network access to \"$DB_USER\"."
