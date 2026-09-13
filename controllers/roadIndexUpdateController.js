const roadIndexUpdateService = require("../services/roadIndexUpdateService");
const updateAvailabilityService = require("../services/updateAvailabilityService");
const roadStatsService = require("../services/roadStatsService");

exports.availability = async (_req, res, next) => {
  try {
    res.status(200).json(await updateAvailabilityService.check());
  } catch (error) {
    next(error);
  }
};

exports.create = async (req, res, next) => {
  try {
    const availability = await updateAvailabilityService.check();
    if (!availability.updateAvailable) {
      return res.status(200).json({ status: "no_changes", ...availability });
    }
    const job = await roadIndexUpdateService.enqueue(req.get("Idempotency-Key"));
    return res.status(202).json(job);
  } catch (error) {
    next(error);
  }
};

exports.get = async (req, res, next) => {
  try {
    res.status(200).json(await roadIndexUpdateService.get(req.params.jobId));
  } catch (error) {
    next(error);
  }
};

exports.stats = async (_req, res, next) => {
  try {
    res.status(200).json(await roadStatsService.getStats());
  } catch (error) {
    next(error);
  }
};
