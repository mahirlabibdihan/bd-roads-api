#!/usr/bin/env bash
set -Eeuo pipefail
ENV_FILE=/app/.env
MARKER=/srv/road-network/.import-complete
[[ -r "$ENV_FILE" ]] || { echo "Missing /app/.env. Run: bash scripts/docker-up.sh" >&2; exit 1; }
chown road-network:road-network /srv/road-network /srv/osm-pbf

service postgresql start
if [[ ! -f "$MARKER" ]]; then
  echo "First start: importing the Bangladesh road network. This takes a while."
  # Only the PostGIS half runs here. The OSRM graph is built by the osrm-build Compose service,
  # from its own official image -- Docker cannot be nested inside this container.
  bash /app/scripts/setup-road-network.sh "$ENV_FILE"
fi
service postgresql stop || true
exec /usr/bin/supervisord -n -c /app/docker/supervisord.conf
