-- Applied after the osm2pgsql import (and it is safe to re-run). osm2pgsql creates the roads
-- table and its way_id index itself; these are the indexes the API's own query shapes need.

-- Geometry GIST, used by GET /api/roads: "geom && ST_MakeEnvelope(...)" for bbox extraction.
CREATE INDEX IF NOT EXISTS idx_roads_geom ON roads USING GIST (geom);

-- Geography GIST on the same column. Snapping asks for distances in metres, and both
-- ST_DWithin(geom::geography, ...) and the "geom::geography <-> point" nearest-neighbour ordering
-- can only use an index that is built on the cast expression -- the plain geometry index above
-- does not qualify for them. Without this, every /api/snap call sequential-scans the table.
CREATE INDEX IF NOT EXISTS idx_roads_geog ON roads USING GIST ((geom::geography));

-- Supports the optional ?classes= filter.
CREATE INDEX IF NOT EXISTS idx_roads_highway ON roads (highway);

ANALYZE roads;
