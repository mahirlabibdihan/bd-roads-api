const clientError = (message) => {
  const error = new Error(message);
  error.status = 400;
  return error;
};

// Bangladesh, with a small margin. Same box bpo-postcode-osm applies to Photon searches, and it
// keeps a mistyped bbox from asking PostGIS about somewhere there is no data for anyway.
const BANGLADESH_BBOX = { minLon: 88.0, minLat: 20.5, maxLon: 92.8, maxLat: 26.7 };

const finiteNumber = (value, name) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw clientError(`${name} must be a number`);
  return parsed;
};

const parseLongitude = (value, name = "lon") => {
  const longitude = finiteNumber(value, name);
  if (longitude < -180 || longitude > 180) throw clientError(`${name} must be between -180 and 180`);
  return longitude;
};

const parseLatitude = (value, name = "lat") => {
  const latitude = finiteNumber(value, name);
  if (latitude < -90 || latitude > 90) throw clientError(`${name} must be between -90 and 90`);
  return latitude;
};

const parseBbox = (value, maxDegrees) => {
  if (typeof value !== "string" || !value.trim()) {
    throw clientError("bbox is required as minLon,minLat,maxLon,maxLat");
  }
  const parts = value.split(",").map((part) => part.trim());
  if (parts.length !== 4) throw clientError("bbox must have four comma-separated values");

  const minLon = parseLongitude(parts[0], "bbox minLon");
  const minLat = parseLatitude(parts[1], "bbox minLat");
  const maxLon = parseLongitude(parts[2], "bbox maxLon");
  const maxLat = parseLatitude(parts[3], "bbox maxLat");

  if (minLon >= maxLon) throw clientError("bbox minLon must be less than maxLon");
  if (minLat >= maxLat) throw clientError("bbox minLat must be less than maxLat");
  if (maxLon - minLon > maxDegrees || maxLat - minLat > maxDegrees) {
    throw clientError(`bbox may not span more than ${maxDegrees} degrees on either axis`);
  }
  return { minLon, minLat, maxLon, maxLat };
};

// Passed to PostGIS as a text[] bound parameter, so this validation is about giving a clear error
// for a typo rather than about safety. Returning null means "every class".
const parseClasses = (value) => {
  if (value === undefined || value === null || value === "") return null;
  const classes = String(value)
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  if (classes.length === 0) return null;
  for (const entry of classes) {
    if (!/^[a-z_]+$/.test(entry)) throw clientError(`Invalid highway class: ${entry}`);
  }
  return classes;
};

const parseRadius = (value, { fallback, max }) => {
  if (value === undefined || value === "") return fallback;
  const radius = finiteNumber(value, "radius");
  if (radius <= 0) throw clientError("radius must be greater than 0");
  if (radius > max) throw clientError(`radius may not exceed ${max} metres`);
  return radius;
};

const parseLimit = (value, { fallback, max }) => {
  if (value === undefined || value === "") return fallback;
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1) throw clientError("limit must be a positive integer");
  return Math.min(limit, max);
};

// [[lon, lat], ...] in GeoJSON order, matching what the frontend already holds for a boundary ring
// and what beat_boundary_walks.path stores. Returned as parallel arrays because that is the shape
// PostGIS unnest() and OSRM's path parameter each want.
const parsePoints = (value, maxPoints) => {
  if (!Array.isArray(value) || value.length === 0) {
    throw clientError("points must be a non-empty array of [longitude, latitude] pairs");
  }
  if (value.length > maxPoints) {
    throw clientError(`points may not contain more than ${maxPoints} entries`);
  }
  const lons = [];
  const lats = [];
  value.forEach((point, index) => {
    if (!Array.isArray(point) || point.length < 2) {
      throw clientError(`points[${index}] must be a [longitude, latitude] pair`);
    }
    lons.push(parseLongitude(point[0], `points[${index}][0]`));
    lats.push(parseLatitude(point[1], `points[${index}][1]`));
  });
  return { lons, lats };
};

module.exports = {
  BANGLADESH_BBOX,
  clientError,
  parseBbox,
  parseClasses,
  parseLatitude,
  parseLimit,
  parseLongitude,
  parsePoints,
  parseRadius,
};
