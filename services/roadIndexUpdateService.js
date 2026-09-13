const { createHash, randomBytes } = require("node:crypto");
const { ROAD_INDEX_UPDATE_ENABLED } = require("../config/config");
const queueStore = require("../queues/roadIndexUpdateQueue");

const serviceError = (message, status, code) => {
  const error = new Error(message);
  error.status = status;
  error.expose = true;
  if (code) error.code = code;
  return error;
};

const serialize = async (job) => ({
  jobId: job.id,
  status: await job.getState(),
  progress: job.progress || 0,
  createdAt: new Date(job.timestamp).toISOString(),
  startedAt: job.processedOn ? new Date(job.processedOn).toISOString() : null,
  finishedAt: job.finishedOn ? new Date(job.finishedOn).toISOString() : null,
  failedReason: job.failedReason || null,
});

const withRedis = async (operation) => {
  if (!ROAD_INDEX_UPDATE_ENABLED) {
    throw serviceError("Background road-index updates are disabled", 503);
  }

  let queue;
  try {
    queue = queueStore.getQueue();
    await queue.waitUntilReady();
  } catch (_cause) {
    await queueStore.resetQueue();
    throw serviceError(
      "Background road-index updates are disabled because Redis is unavailable",
      503,
      "ROAD_INDEX_UPDATES_UNAVAILABLE",
    );
  }
  return operation(queue);
};

exports.enqueue = async (idempotencyKey) =>
  withRedis(async (queue) => {
    const key = idempotencyKey || randomBytes(16).toString("hex");
    const jobId = `update-${createHash("sha256").update(key).digest("hex")}`;
    let job = await queue.getJob(jobId);
    if (!job) {
      job = await queue.add(
        "update",
        {},
        {
          jobId,
          attempts: 1,
          removeOnComplete: { age: 604800, count: 100 },
          removeOnFail: { age: 2592000, count: 100 },
        },
      );
    }
    return serialize(job);
  });

exports.get = async (jobId) =>
  withRedis(async (queue) => {
    const job = await queue.getJob(jobId);
    if (!job) throw serviceError("Road-index update job not found", 404);
    return serialize(job);
  });

exports.isAvailable = async () => {
  if (!ROAD_INDEX_UPDATE_ENABLED) return false;
  try {
    return (await withRedis(async (queue) => (await queue.client).ping())) === "PONG";
  } catch (_error) {
    return false;
  }
};
