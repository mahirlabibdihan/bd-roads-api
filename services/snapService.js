const { SNAP_DEFAULT_RADIUS_METERS, SNAP_MAX_POINTS, SNAP_MAX_RADIUS_METERS } = require("../config/config");
const { query, unavailable } = require("../db/pool");
const { parseClasses, parseLatitude, parseLongitude, parsePoints, parseRadius } = require("../utils/validation");

// ST_ClosestPoint returns the point on the road nearest the input, which is what snapping means --
// it is not restricted to the road's own vertices, so a point halfway along a straight segment
// snaps to the perpendicular foot rather than jumping to a distant corner.
//
// Both the ST_DWithin filter and the "<->" nearest-neighbour ordering run on geom::geography so
// the radius and the ranking are true metres on the spheroid. That is only fast because
// sql/indexes.sql builds idx_roads_geog on exactly that cast expression.
const SNAP_SELECT = `
  SELECT
    r.way_id,
    r.highway,
    r.name,
    r.name_bn,
    ST_X(ST_ClosestPoint(r.geom, input.geom)) AS lon,
    ST_Y(ST_ClosestPoint(r.geom, input.geom)) AS lat,
    ST_Distance(r.geom::geography, input.geom::geography) AS distance_m
  FROM roads r
  WHERE ST_DWithin(r.geom::geography, input.geom::geography, $RADIUS)
    AND ($CLASSES::text[] IS NULL OR r.highway = ANY($CLASSES::text[]))
  ORDER BY r.geom::geography <-> input.geom::geography
  LIMIT 1
`;

const SNAP_POINT = `
  WITH input AS (SELECT ST_SetSRID(ST_MakePoint($1, $2), 4326) AS geom)
  SELECT nearest.*
  FROM input
  LEFT JOIN LATERAL (
    ${SNAP_SELECT.replaceAll("$RADIUS", "$3").replaceAll("$CLASSES", "$4")}
  ) nearest ON true
`;

// The whole ring in one round trip. unnest() over two parallel arrays WITH ORDINALITY keeps the
// caller's ordering, and LEFT JOIN LATERAL means a point with no road inside the radius comes back
// as a null row rather than vanishing -- the caller still needs to know which index failed.
const SNAP_PATH = `
  WITH input AS (
    SELECT ordinality AS idx, ST_SetSRID(ST_MakePoint(lon, lat), 4326) AS geom
    FROM unnest($1::double precision[], $2::double precision[]) WITH ORDINALITY AS t(lon, lat, ordinality)
  )
  SELECT input.idx, nearest.*
  FROM input
  LEFT JOIN LATERAL (
    ${SNAP_SELECT.replaceAll("$RADIUS", "$3").replaceAll("$CLASSES", "$4")}
  ) nearest ON true
  ORDER BY input.idx
`;

const toSnapped = (row) => {
  if (!row || row.lon === null || row.lon === undefined) return null;
  return {
    coordinates: [Number(row.lon), Number(row.lat)],
    distanceMeters: Number(row.distance_m),
    road: {
      osmId: Number(row.way_id),
      osmType: "W",
      highway: row.highway,
      name: row.name,
      nameBn: row.name_bn,
    },
  };
};

class SnapService {
  point = async ({ lat, lon, radius, classes }) => {
    const latitude = parseLatitude(lat);
    const longitude = parseLongitude(lon);
    const searchRadius = parseRadius(radius, {
      fallback: SNAP_DEFAULT_RADIUS_METERS,
      max: SNAP_MAX_RADIUS_METERS,
    });
    const highwayClasses = parseClasses(classes);

    let result;
    try {
      result = await query(SNAP_POINT, [longitude, latitude, searchRadius, highwayClasses]);
    } catch (cause) {
      throw unavailable("Road snapping is temporarily unavailable")(cause);
    }

    // No road within the radius is an ordinary answer, not a failure: plenty of Bangladesh is
    // genuinely more than 50 m from any mapped way. The caller keeps its original point.
    return {
      snapped: toSnapped(result.rows[0]),
      input: [longitude, latitude],
      radiusMeters: searchRadius,
    };
  };

  path = async ({ points, radius, classes }) => {
    const { lons, lats } = parsePoints(points, SNAP_MAX_POINTS);
    const searchRadius = parseRadius(radius, {
      fallback: SNAP_DEFAULT_RADIUS_METERS,
      max: SNAP_MAX_RADIUS_METERS,
    });
    const highwayClasses = parseClasses(classes);

    let result;
    try {
      result = await query(SNAP_PATH, [lons, lats, searchRadius, highwayClasses]);
    } catch (cause) {
      throw unavailable("Road snapping is temporarily unavailable")(cause);
    }

    const snapped = result.rows.map(toSnapped);
    return {
      snapped,
      radiusMeters: searchRadius,
      pointCount: snapped.length,
      unsnappedCount: snapped.filter((entry) => entry === null).length,
    };
  };
}

module.exports = new SnapService();
