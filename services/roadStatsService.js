const { query, unavailable } = require("../db/pool");
const replicationState = require("../db/replicationState");

// The number that matters when judging this import against the Nominatim one is unnamedRoads:
// those are the ways a geocoder discards and a boundary follows. If that count is near zero,
// something filtered them out and snapping will be worse than it looks.
const STATS = `
  SELECT
    count(*)::int AS total_roads,
    count(*) FILTER (WHERE name IS NULL)::int AS unnamed_roads,
    count(*) FILTER (WHERE highway IN ('track', 'path', 'footway', 'steps', 'bridleway'))::int AS tracks_and_paths,
    round(sum(ST_Length(geom::geography))::numeric / 1000, 1)::float8 AS total_length_km
  FROM roads
`;

const BY_CLASS = `
  SELECT highway, count(*)::int AS count
  FROM roads
  GROUP BY highway
  ORDER BY count DESC
`;

exports.getStats = async () => {
  try {
    const [totals, byClass, replication] = await Promise.all([query(STATS), query(BY_CLASS), replicationState.read()]);
    const row = totals.rows[0];
    return {
      totalRoads: row.total_roads,
      unnamedRoads: row.unnamed_roads,
      tracksAndPaths: row.tracks_and_paths,
      totalLengthKm: row.total_length_km,
      byHighwayClass: Object.fromEntries(byClass.rows.map((entry) => [entry.highway, entry.count])),
      localDataTimestamp: new Date(replication.timestamp).toISOString(),
      localSequence: replication.sequence === null ? null : String(replication.sequence),
      checkedAt: new Date().toISOString(),
    };
  } catch (cause) {
    throw unavailable("Road network stats are temporarily unavailable")(cause);
  }
};
