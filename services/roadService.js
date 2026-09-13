const { ROADS_DEFAULT_LIMIT, ROADS_MAX_BBOX_DEGREES, ROADS_MAX_LIMIT } = require("../config/config");
const { query, unavailable } = require("../db/pool");
const { parseBbox, parseClasses, parseLimit } = require("../utils/validation");

// ST_Intersection clips each road to the requested viewport, so a highway crossing the whole
// country does not ship its entire geometry for a two-kilometre box. Clipping a line at a box edge
// can yield a bare point (where it only grazes a corner) or a collection, so ST_CollectionExtract
// with type 2 keeps the line parts only; anything left empty is dropped by the outer filter.
const ROADS_IN_BBOX = `
  WITH box AS (SELECT ST_MakeEnvelope($1, $2, $3, $4, 4326) AS geom)
  SELECT
    r.way_id,
    r.highway,
    r.name,
    r.name_bn,
    r.ref,
    r.surface,
    r.bridge,
    r.tunnel,
    ST_AsGeoJSON(clipped.geom)::json AS geometry
  FROM roads r
  CROSS JOIN box
  CROSS JOIN LATERAL (
    SELECT CASE
      WHEN $6::double precision IS NULL THEN ST_CollectionExtract(ST_Intersection(r.geom, box.geom), 2)
      ELSE ST_SimplifyPreserveTopology(
        ST_CollectionExtract(ST_Intersection(r.geom, box.geom), 2),
        $6::double precision
      )
    END AS geom
  ) clipped
  WHERE r.geom && box.geom
    AND ($5::text[] IS NULL OR r.highway = ANY($5::text[]))
    AND NOT ST_IsEmpty(clipped.geom)
  LIMIT $7::int
`;

class RoadService {
  // GeoJSON so the web frontend can hand the response straight to Leaflet and snap client-side
  // while the user is drawing, without a round trip per vertex.
  inBoundingBox = async ({ bbox, classes, limit, simplify }) => {
    const box = parseBbox(bbox, ROADS_MAX_BBOX_DEGREES);
    const highwayClasses = parseClasses(classes);
    const featureLimit = parseLimit(limit, { fallback: ROADS_DEFAULT_LIMIT, max: ROADS_MAX_LIMIT });

    let tolerance = null;
    if (simplify !== undefined && simplify !== "") {
      tolerance = Number(simplify);
      if (!Number.isFinite(tolerance) || tolerance < 0) {
        const error = new Error("simplify must be a non-negative number of degrees");
        error.status = 400;
        throw error;
      }
      if (tolerance === 0) tolerance = null;
    }

    let result;
    try {
      result = await query(ROADS_IN_BBOX, [
        box.minLon,
        box.minLat,
        box.maxLon,
        box.maxLat,
        highwayClasses,
        tolerance,
        featureLimit,
      ]);
    } catch (cause) {
      throw unavailable("Road network is temporarily unavailable")(cause);
    }

    return {
      type: "FeatureCollection",
      features: result.rows.map((row) => ({
        type: "Feature",
        geometry: row.geometry,
        properties: {
          osmId: Number(row.way_id),
          osmType: "W",
          highway: row.highway,
          name: row.name,
          nameBn: row.name_bn,
          ref: row.ref,
          surface: row.surface,
          bridge: row.bridge,
          tunnel: row.tunnel,
        },
      })),
      // The caller needs to know a viewport hit the cap, otherwise it silently snaps against a
      // partial network and the user sees points jump to the wrong road.
      truncated: result.rows.length >= featureLimit,
    };
  };
}

module.exports = new RoadService();
