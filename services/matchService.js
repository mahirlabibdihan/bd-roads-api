const {
  OSRM_MATCH_URL,
  OSRM_MAX_MATCHING_SIZE,
  OSRM_PROFILE,
  OSRM_REQUEST_TIMEOUT_MS,
  SNAP_DEFAULT_RADIUS_METERS,
  SNAP_MAX_RADIUS_METERS,
} = require("../config/config");
const { clientError, parsePoints, parseRadius } = require("../utils/validation");

// What this does that POST /api/snap/path does not: snapping treats every point independently, so
// where two ways run close together -- a road and its service lane, the two banks of a canal --
// consecutive GPS fixes each pick whichever line happens to be nearest to them alone, and the
// result zig-zags between the two. Map matching scores the sequence as a whole and returns the
// single most likely connected path along the network.
//
// Use this for beat_boundary_walks.path (a recorded GPS trace). Use /api/snap/path for vertices a
// person placed deliberately by clicking a map, where there is no noise to model.

const CODE_STATUS = {
  NoMatch: 422,
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

class MatchService {
  match = async ({ points, radius, timestamps, tidy }) => {
    const { lons, lats } = parsePoints(points, OSRM_MAX_MATCHING_SIZE);
    const searchRadius = parseRadius(radius, {
      fallback: SNAP_DEFAULT_RADIUS_METERS,
      max: SNAP_MAX_RADIUS_METERS,
    });

    if (timestamps !== undefined) {
      if (!Array.isArray(timestamps) || timestamps.length !== lons.length) {
        throw clientError("timestamps must be an array of UNIX seconds, one per point");
      }
      for (const [index, value] of timestamps.entries()) {
        if (!Number.isInteger(value) || value < 0) {
          throw clientError(`timestamps[${index}] must be a non-negative integer of UNIX seconds`);
        }
      }
    }

    const coordinates = lons.map((lon, index) => `${lon},${lats[index]}`).join(";");
    const url = new URL(`${OSRM_MATCH_URL}/${OSRM_PROFILE}/${coordinates}`);
    url.searchParams.set("geometries", "geojson");
    url.searchParams.set("overview", "full");
    url.searchParams.set("steps", "false");
    // A boundary walk is one continuous route, so a gap in the trace (the postman went indoors,
    // GPS dropped) should not split the result into separate matchings.
    url.searchParams.set("gaps", "ignore");
    // tidy drops near-duplicate fixes -- standing still for a minute otherwise contributes dozens
    // of points that pull the match toward whatever is nearest that one spot.
    url.searchParams.set("tidy", tidy === false ? "false" : "true");
    url.searchParams.set("radiuses", lons.map(() => searchRadius).join(";"));
    if (timestamps) url.searchParams.set("timestamps", timestamps.join(";"));

    let response;
    try {
      response = await fetch(url, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(OSRM_REQUEST_TIMEOUT_MS),
      });
    } catch (cause) {
      const error = new Error("Map matching is temporarily unavailable", { cause });
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
      const status = CODE_STATUS[body.code] || (response.ok ? 502 : 502);
      throw upstreamError(body.message || `OSRM returned ${body.code}`, status, body.code);
    }

    const matchings = (body.matchings || []).map((matching) => ({
      confidence: matching.confidence,
      distanceMeters: matching.distance,
      durationSeconds: matching.duration,
      geometry: matching.geometry,
    }));

    // OSRM returns null for any input point it could not place on the network. Preserving those
    // nulls keeps the array index-aligned with the caller's input, so it can report which fixes
    // were dropped instead of silently shifting the rest of the trace.
    const tracepoints = (body.tracepoints || []).map((tracepoint) =>
      tracepoint
        ? {
            coordinates: tracepoint.location,
            distanceMeters: tracepoint.distance,
            matchingIndex: tracepoint.matchings_index,
            waypointIndex: tracepoint.waypoint_index,
            name: tracepoint.name || null,
          }
        : null,
    );

    return {
      matchings,
      tracepoints,
      pointCount: tracepoints.length,
      unmatchedCount: tracepoints.filter((tracepoint) => tracepoint === null).length,
      radiusMeters: searchRadius,
      profile: OSRM_PROFILE,
    };
  };
}

module.exports = new MatchService();
