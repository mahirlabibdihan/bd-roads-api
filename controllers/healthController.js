const healthService = require("../services/healthService");

exports.health = async (_req, res) => {
  const result = await healthService.readiness();
  // "degraded" still answers 200: only the road database going down makes the service unable to
  // do the thing it exists for. See healthService.readiness.
  res.status(result.status === "unavailable" ? 503 : 200).json(result);
};
