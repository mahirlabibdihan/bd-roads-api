const { OSRM_BASE_URL, OSRM_PROFILE, OSRM_REQUEST_TIMEOUT_MS } = require("../config/config");
const { query } = require("../db/pool");
const roadIndexUpdateService = require("./roadIndexUpdateService");

const roadsAvailable = async () => {
  try {
    const result = await query("SELECT 1 FROM roads LIMIT 1");
    return result.rows.length > 0;
  } catch (_error) {
    return false;
  }
};

// /nearest is the cheapest OSRM endpoint that still proves the graph is loaded -- it touches the
// same road network /match uses, unlike a bare TCP connect.
const osrmAvailable = async () => {
  try {
    const url = new URL(`/nearest/v1/${OSRM_PROFILE}/90.4125,23.8103`, OSRM_BASE_URL);
    url.searchParams.set("number", "1");
    const response = await fetch(url, { signal: AbortSignal.timeout(OSRM_REQUEST_TIMEOUT_MS) });
    if (!response.ok) return false;
    return (await response.json()).code === "Ok";
  } catch (_error) {
    return false;
  }
};

exports.readiness = async () => {
  const [roads, osrm, updates] = await Promise.all([
    roadsAvailable(),
    osrmAvailable(),
    roadIndexUpdateService.isAvailable(),
  ]);

  // Losing OSRM costs map matching but leaves /api/roads and /api/snap fully working, so it is
  // reported as degraded rather than unavailable -- a container healthcheck should not restart a
  // service that is still doing most of its job.
  const status = roads ? (osrm ? "ok" : "degraded") : "unavailable";

  return {
    status,
    dependencies: { roads: roads ? "up" : "down", osrm: osrm ? "up" : "down" },
    features: {
      roadExtract: roads ? "enabled" : "disabled",
      snapping: roads ? "enabled" : "disabled",
      mapMatching: osrm ? "enabled" : "disabled",
      roadIndexUpdates: updates ? "enabled" : "disabled",
    },
  };
};
