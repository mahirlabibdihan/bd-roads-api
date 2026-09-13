const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { Worker } = require("bullmq");
const { connection } = require("../config/redis");
const {
  OSRM_BUILD_SCRIPT,
  ROAD_INDEX_OSRM_REBUILD_ENABLED,
  ROAD_INDEX_UPDATE_TIMEOUT_SECONDS,
  ROADS_ENV_FILE,
  ROADS_UPDATE_SCRIPT,
} = require("../config/config");
const { QUEUE_NAME } = require("../queues/roadIndexUpdateQueue");
const replicationState = require("../db/replicationState");
const { hasNewState } = require("../utils/replicationSequence");
const snapService = require("../services/snapService");

const execFileAsync = promisify(execFile);

const runScript = (script) =>
  execFileAsync("/bin/bash", [script, ROADS_ENV_FILE], {
    timeout: ROAD_INDEX_UPDATE_TIMEOUT_SECONDS * 1000,
    maxBuffer: 10 * 1024 * 1024,
  });

// Proves the import still answers the query the whole service exists for, rather than only that
// the process exited zero. A 500 m radius around central Dhaka finds a road in any sane import.
const smokeTest = async () => {
  const result = await snapService.point({ lat: 23.8103, lon: 90.4125, radius: 500 });
  if (!result.snapped) throw new Error("Snap smoke test found no road near central Dhaka");
};

const worker = new Worker(
  QUEUE_NAME,
  async (job) => {
    const before = await replicationState.read();
    await job.updateProgress({ state: "updating_roads", sequenceBefore: String(before.sequence) });
    await runScript(ROADS_UPDATE_SCRIPT);
    const after = await replicationState.read();

    if (!hasNewState(before, after)) {
      const result = { outcome: "no_changes", sequence: String(after.sequence) };
      await job.updateProgress({ state: "succeeded", ...result });
      return result;
    }

    // OSRM has no incremental update path: its graph is compiled from a PBF, so refreshing it
    // means re-downloading Bangladesh and re-running extract/partition/customize. That is far
    // slower than the PostGIS diff apply above, which is why it is opt-in. /api/snap and
    // /api/roads are already current at this point either way; only /api/match lags.
    let osrm = "skipped";
    if (ROAD_INDEX_OSRM_REBUILD_ENABLED) {
      await job.updateProgress({ state: "rebuilding_osrm" });
      await runScript(OSRM_BUILD_SCRIPT);
      osrm = "rebuilt";
    }

    await job.updateProgress({ state: "verifying" });
    await smokeTest();
    const result = { outcome: "updated", sequence: String(after.sequence), osrm };
    await job.updateProgress({ state: "succeeded", ...result });
    return result;
  },
  { connection, concurrency: 1 },
);

worker.on("completed", (job, result) => {
  console.log(`Road-index update ${job.id} completed (${result.outcome}, osrm ${result.osrm || "n/a"})`);
});
worker.on("failed", (job, error) => console.error(`Road-index update ${job?.id} failed`, error));
console.log("Road-index update worker started");

module.exports = { smokeTest };
