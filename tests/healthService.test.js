jest.mock("../db/pool", () => ({ query: jest.fn() }));
jest.mock("../services/roadIndexUpdateService", () => ({ isAvailable: jest.fn() }));
const { query } = require("../db/pool");
const updates = require("../services/roadIndexUpdateService");
const health = require("../services/healthService");
const { HEALTH_TIMEOUT_MS } = require("../config/config");
const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
  jest.useRealTimers();
});

test("returns degraded within its deadline when OSRM and Redis stall", async () => {
  jest.useFakeTimers();
  query.mockResolvedValue({ rows: [1] });
  updates.isAvailable.mockImplementation(() => new Promise(() => {}));
  global.fetch = jest.fn(() => new Promise(() => {}));
  const result = health.readiness();
  await jest.advanceTimersByTimeAsync(HEALTH_TIMEOUT_MS + 1);
  await expect(result).resolves.toMatchObject({ status: "degraded", dependencies: { roads: "up", osrm: "down" } });
});

test("returns unavailable within its deadline when the database stalls", async () => {
  jest.useFakeTimers();
  query.mockImplementation(() => new Promise(() => {}));
  updates.isAvailable.mockResolvedValue(true);
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ code: "Ok" }) });
  const result = health.readiness();
  await jest.advanceTimersByTimeAsync(HEALTH_TIMEOUT_MS + 1);
  await expect(result).resolves.toMatchObject({ status: "unavailable" });
});
