const {
  OSRM_ROUTE_URL,
  OSRM_PROFILE,
  OSRM_REQUEST_TIMEOUT_MS,
  OSRM_ROUTE_CONCURRENCY,
  OSRM_FAILURE_COOLDOWN_MS,
} = require("../config/config");
const { UpstreamGate } = require("../utils/upstreamGate");
const gate = new UpstreamGate({
  concurrency: OSRM_ROUTE_CONCURRENCY,
  cooldownMs: OSRM_FAILURE_COOLDOWN_MS,
  label: "Routing",
});
const { clientError, parsePoints } = require("../utils/validation");

// Shortest path between fixed waypoints along the road network -- unlike /api/match, this has no
// GPS trace to score, just two (or a few) points someone already knows, wanting the road route
// between them. Used to snap a boundary's own gaps: the stretch bpo-postcode-backend's beat
// boundary builder leaves out of its /match call (see that repo's lib/boundaryMerge.js), which
// would otherwise become a straight line drawn regardless of what lies between the two points.

const MAX_ROUTE_POINTS = 25;

const CODE_STATUS = {
  NoRoute: 422,
  NoSegment: 422,
  TooBig: 400,
  InvalidOptions: 400,
  InvalidQuery: 400,
  InvalidValue: 400,
};

const upstreamError = (message, status, code) => {
  const error = new Error(message);
  error.status = status;
  error.expose = true;
  if (code) error.code = code;
  return error;
};

class RouteService {
  route = async ({ points }) => {
    const { lons, lats } = parsePoints(points, MAX_ROUTE_POINTS);
    if (lons.length < 2) throw clientError("Routing requires at least two points");

    const coordinates = lons.map((lon, index) => `${lon},${lats[index]}`).join(";");
    const url = new URL(`${OSRM_ROUTE_URL}/${OSRM_PROFILE}/${coordinates}`);
    url.searchParams.set("geometries", "geojson");
    url.searchParams.set("overview", "full");
    url.searchParams.set("steps", "false");
    url.searchParams.set("alternatives", "false");

    const body = await gate.run(async () => {
      let response;
      try {
        response = await fetch(url, {
          headers: { accept: "application/json" },
          signal: AbortSignal.timeout(OSRM_REQUEST_TIMEOUT_MS),
        });
      } catch (cause) {
        const error = new Error("Routing is temporarily unavailable", { cause });
        error.status = 503;
        error.expose = true;
        throw error;
      }

      let body;
      try {
        body = await response.json();
      } catch (_cause) {
        throw upstreamError(`OSRM returned an unreadable response (HTTP ${response.status})`, 502);
      }

      if (body.code !== "Ok") {
        const status = CODE_STATUS[body.code] || 502;
        throw upstreamError(body.message || `OSRM returned ${body.code}`, status, body.code);
      }
      if (!response.ok) throw upstreamError(`OSRM returned HTTP ${response.status}`, 502);
      return body;
    });

    const route = (body.routes || [])[0];
    if (!route) throw upstreamError("OSRM returned no route", 502);

    return {
      coordinates: route.geometry?.coordinates || [],
      distanceMeters: route.distance,
      durationSeconds: route.duration,
      profile: OSRM_PROFILE,
    };
  };
}

module.exports = new RouteService();
