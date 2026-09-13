# Bangladesh Road Network Backend

Road geometry and road snapping for the postcode platform. Boundary points drawn in the web
frontend, and GPS traces recorded by postmen, are aligned to the OpenStreetMap road network here.

```text
Geofabrik PBF -> osm2pgsql (roads-only Lua flex) -> PostGIS `roads` -> Express API
              |                                                           ^
              +-> OSRM (extract/partition/customize) -> osrm-routed ------+
                                        Redis/BullMQ update worker -------+
```

The scripts target Ubuntu 24.04/WSL2, Node.js 22, PostgreSQL 16 with PostGIS, osm2pgsql 1.11+,
OSRM 5.27.1, and Bangladesh data. Nothing here runs on Windows -- develop on Windows if you like,
but run `scripts/` on the server, the same way `bpo-postcode-osm` is run.

## Why this is a separate import from `bpo-postcode-osm`

Nominatim already holds road linework, and reusing it was the obvious shortcut. It does not work,
because Nominatim is a geocoder: its import keeps what people can search for by name and discards
the rest. An unnamed track or footpath never reaches `placex` at all -- geometry included.

Those are exactly the ways a rural beat boundary follows. Snapping needs the line, not the label,
so `osm2pgsql/roads.lua` reads the PBF directly and keeps every way in its highway set regardless
of whether it is named. `GET /api/admin/update/stats` reports `unnamedRoads` for this reason: if
that number is near zero, something filtered them out and snapping is worse than it looks.

To see the difference on your own data, run this against the Nominatim database:

```bash
psql -d nominatim -c "SELECT type, count(*) FILTER (WHERE name IS NULL) AS unnamed, count(*) AS total FROM placex WHERE class='highway' GROUP BY type ORDER BY total DESC"
```

## Snapping versus map matching

Both are provided because they solve different problems, and using the wrong one produces
boundaries that look plausible and are wrong.

|                   | `POST /api/snap/path`                      | `POST /api/match`                                |
| ----------------- | ------------------------------------------ | ------------------------------------------------ |
| Treats each point | independently                              | as one sequence                                  |
| Backed by         | PostGIS `ST_ClosestPoint`                  | OSRM map matching                                |
| Right for         | vertices a person placed by clicking a map | recorded GPS traces (`beat_boundary_walks.path`) |
| Fails when        | two ways run close together                | the trace leaves the road network entirely       |

Snapping has no memory: point 7 does not know that point 6 chose road A. Where a road and its
service lane run 15 m apart, consecutive noisy GPS fixes each pick whichever line is nearest to
them alone and the result zig-zags between the two. Map matching scores the whole sequence and
returns the single most likely connected path.

## Quick start

### Docker (recommended)

```bash
bash scripts/docker-up.sh
```

Three containers, unlike `bpo-postcode-osm`'s single one -- OSRM ships its own official image and
Docker cannot be nested inside the application container:

| Service        | Image                               | Role                                                     |
| -------------- | ----------------------------------- | -------------------------------------------------------- |
| `road-network` | built here                          | PostgreSQL/PostGIS, osm2pgsql, Redis, API, update worker |
| `osrm-build`   | `ghcr.io/project-osrm/osrm-backend` | one-shot graph build, then exits                         |
| `osrm`         | `ghcr.io/project-osrm/osrm-backend` | serves `/match`                                          |

Only the API port is published. `osrm-build` waits for `road-network` to become healthy, so the
PBF it needs has already been downloaded into the shared `osm-pbf` volume -- Bangladesh is fetched
once, not twice.

The API reports healthy _before_ the OSRM graph finishes building. That is deliberate:
`/api/roads` and `/api/snap` work without OSRM, so the stack is usable during the wait and a
container healthcheck does not restart a service that is still doing most of its job.
`/api/health` reports `status: "degraded"` and `dependencies.osrm: "down"` until matching comes up.

```bash
bash scripts/docker-up.sh --port 5003
docker compose logs -f
docker compose down
```

Named volumes preserve the PostGIS database, the PBF, and the OSRM graph. `docker compose down -v`
permanently removes all of it.

### Bare metal

```bash
sudo bash scripts/setup-all.sh
bash scripts/run-stack.sh
```

`setup-all.sh` generates `.env` from `.env.example` with random secrets on first run and pauses so
you can review it. It never overwrites an existing `.env`.

The OSRM stage still uses Docker, because OSRM is not packaged for Ubuntu and a source build is
version-sensitive against whatever boost/TBB the distribution ships. If Docker is unavailable that
stage fails loudly and the rest of the install continues -- road extraction and snapping work; only
`/api/match` stays unavailable.

## API usage

```bash
API=http://127.0.0.1:5003
```

### Road network for a viewport

Returns GeoJSON clipped to the bbox, for snapping client-side while the user draws.

```bash
curl --get "$API/api/roads" --data 'bbox=90.39,23.79,90.43,23.83' --data 'classes=residential,track,path' | jq
```

| Parameter  | Default  | Notes                                                             |
| ---------- | -------- | ----------------------------------------------------------------- |
| `bbox`     | required | `minLon,minLat,maxLon,maxLat`, capped by `ROADS_MAX_BBOX_DEGREES` |
| `classes`  | all      | comma-separated `highway` values                                  |
| `limit`    | `2000`   | capped by `ROADS_MAX_LIMIT`                                       |
| `simplify` | none     | `ST_SimplifyPreserveTopology` tolerance in degrees                |

Check `truncated` in the response. When it is `true` the viewport hit `limit` and you are looking
at a partial network -- snapping against it will put points on the wrong road.

### Snap one point

```bash
curl --get "$API/api/snap" --data 'lat=23.8103' --data 'lon=90.4125' --data 'radius=100' | jq
```

`snapped` is `null` when no road lies within `radius`. That is an ordinary answer, not an error:
plenty of Bangladesh is genuinely more than 50 m from any mapped way, and the caller should keep
its original point.

### Snap a whole boundary ring

```bash
curl -sS -X POST "$API/api/snap/path" -H 'Content-Type: application/json' -d '{"points": [[90.410, 23.810], [90.411, 23.811], [90.412, 23.812]], "radius": 50}' | jq
```

One round trip regardless of ring size (`SNAP_MAX_POINTS`, default 2000). `snapped` is
index-aligned with the input and holds `null` for any point with no road inside the radius, so you
always know which vertex failed.

### Map-match a recorded GPS walk

```bash
curl -sS -X POST "$API/api/match" -H 'Content-Type: application/json' -d '{"points": [[90.410, 23.810], [90.411, 23.811], [90.412, 23.812]], "radius": 25}' | jq
```

Optional `timestamps` (UNIX seconds, one per point) improves matching. `tracepoints` keeps `null`
for fixes OSRM could not place, so it stays aligned with your input. `422` means OSRM could not
match the trace at all -- usually a radius that is too tight, or a walk genuinely off the network.

### Health and admin

```bash
curl -sS "$API/api/health" | jq
export ROAD_INDEX_ADMIN_TOKEN="$(sed -n 's/^ROAD_INDEX_ADMIN_TOKEN=//p' .env)"
```

```bash
curl -sS "$API/api/admin/update/availability" -H "Authorization: Bearer $ROAD_INDEX_ADMIN_TOKEN" | jq
```

```bash
curl -sS "$API/api/admin/update/stats" -H "Authorization: Bearer $ROAD_INDEX_ADMIN_TOKEN" | jq
```

```bash
curl -sS -X POST "$API/api/admin/update" -H "Authorization: Bearer $ROAD_INDEX_ADMIN_TOKEN" -H "Idempotency-Key: $(openssl rand -hex 16)" | jq
```

`POST /api/admin/update` queues a job only when Geofabrik is actually newer; otherwise it returns
`{"status": "no_changes"}` without touching the queue.

## Updates

The PostGIS roads table updates incrementally from Geofabrik diffs via `osm2pgsql-replication`,
the same feed `bpo-postcode-osm` uses. This is fast, and is what the BullMQ worker runs.

**OSRM cannot be updated incrementally.** Its graph is compiled from a PBF, so refreshing it means
re-downloading Bangladesh and re-running extract/partition/customize.
`ROAD_INDEX_OSRM_REBUILD_ENABLED` therefore defaults to `false`, and is forced off inside Docker
(that container has no Docker socket). Routine updates keep `/api/roads` and `/api/snap` current;
`/api/match` runs against the graph from the last build until you rebuild it:

```bash
docker compose run --rm osrm-build
```

```bash
sudo bash scripts/build-osrm.sh
```

## Configuration

`.env` is ignored by Git and sourced by Bash, so use `KEY=value` with no spaces around `=`.

### Values you must change

| Variable                 | What to set                                                  |
| ------------------------ | ------------------------------------------------------------ |
| `ROAD_INDEX_ADMIN_TOKEN` | A long random token authorizing the update APIs.             |
| `DB_PASS`                | Password for the read-only `DB_USER` the API connects as.    |
| `ROADS_DB_PASS`          | Password for the `roads_import` role that owns the database. |

```bash
openssl rand -hex 32
```

### Ports

`bpo-postcode-osm` occupies 5001 (API) and 2322 (Photon), and `bpo-postcode-backend` occupies
5000, so the defaults here avoid all three:

| Port                       | Service                                                                  |
| -------------------------- | ------------------------------------------------------------------------ |
| `5002`                     | this API inside the container (`PORT`)                                   |
| `5003`                     | published host port (`HOST_PORT`)                                        |
| `5010`                     | OSRM on bare metal (`OSRM_LISTEN_PORT`); internal-only under Docker      |
| `redis://127.0.0.1:6379/1` | Redis database 1, keeping this queue off `bpo-postcode-osm`'s database 0 |

### Tuning

| Variable                 | Default | Effect                                                           |
| ------------------------ | ------- | ---------------------------------------------------------------- |
| `ROADS_MAX_BBOX_DEGREES` | `0.5`   | Largest viewport one request may pull (roughly 55 km).           |
| `SNAP_MAX_POINTS`        | `2000`  | Vertices per `/api/snap/path` call.                              |
| `SNAP_MAX_RADIUS_METERS` | `500`   | Upper bound on any snap radius.                                  |
| `OSRM_PROFILE`           | `foot`  | OSRM profile. Postmen walk their beats; `car` ignores footpaths. |
| `OSRM_MAX_MATCHING_SIZE` | `1000`  | Raises OSRM's 100-coordinate default for `/match`.               |
| `OSM2PGSQL_CACHE_MB`     | `2000`  | Import cache. Raise on a machine with spare RAM.                 |

## Scripts

| Command                                   | Purpose                                                          |
| ----------------------------------------- | ---------------------------------------------------------------- |
| `sudo bash scripts/setup-all.sh`          | Full install: backend, PostGIS import, OSRM graph.               |
| `sudo bash scripts/setup-backend.sh`      | Node.js 22, Redis, and npm packages only.                        |
| `sudo bash scripts/setup-road-network.sh` | PostGIS roads import only (`--force` to re-import).              |
| `sudo bash scripts/build-osrm.sh`         | Build or rebuild the OSRM matching graph.                        |
| `bash scripts/run-stack.sh`               | Run OSRM, API, and worker together.                              |
| `bash scripts/run-osrm.sh`                | Run OSRM only.                                                   |
| `bash scripts/update-roads.sh`            | Apply pending Geofabrik diffs by hand.                           |
| `bash scripts/grant-roads-access.sh`      | Re-apply the read-only grants to an existing database.           |
| `bash scripts/docker-up.sh`               | Build and start the Compose stack.                               |
| `sudo bash scripts/reset-all.sh`          | Remove the database, PBF, and OSRM graph. Requires confirmation. |

## Development

```bash
npm install
npm test
npm run dev
```

The tests mock PostgreSQL and OSRM, so the suite runs on any machine -- including Windows --
without a database, Docker, or imported data.

## Schema

`osm2pgsql/roads.lua` produces one table. `way_id` is the OSM way id; osm2pgsql maintains it and
its index for replication updates.

```sql
CREATE TABLE roads (
    way_id  bigint NOT NULL,
    highway text   NOT NULL,
    name    text,
    name_bn text,
    ref     text,
    surface text,
    bridge  boolean NOT NULL,
    tunnel  boolean NOT NULL,
    geom    geometry(LineString, 4326) NOT NULL
);
```

`sql/indexes.sql` adds three indexes. The geography one is not redundant:

```sql
CREATE INDEX idx_roads_geom    ON roads USING GIST (geom);
CREATE INDEX idx_roads_geog    ON roads USING GIST ((geom::geography));
CREATE INDEX idx_roads_highway ON roads (highway);
```

Snapping asks for distances in metres, and both `ST_DWithin(geom::geography, ...)` and the
`geom::geography <-> point` nearest-neighbour ordering can only use an index built on that cast
expression. The plain geometry index does not qualify, and without `idx_roads_geog` every
`/api/snap` call sequential-scans the table.
