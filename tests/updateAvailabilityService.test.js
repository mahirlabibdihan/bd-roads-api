const { parseGeofabrikState } = require("../services/updateAvailabilityService");

test("allows an upstream response slower than the database timeout", async () => {
  jest.useFakeTimers();
  const replicationState = require("../db/replicationState");
  const { check } = require("../services/updateAvailabilityService");
  const { DB_REQUEST_TIMEOUT_MS } = require("../config/config");
  const originalFetch = global.fetch;
  jest.spyOn(replicationState, "read").mockResolvedValue({ timestamp: "2026-09-12T20:21:58Z", sequence: "4876" });
  // Use a timer-backed signal so fake time exercises the real timeout behavior.
  jest.spyOn(AbortSignal, "timeout").mockImplementation((ms) => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), ms);
    return controller.signal;
  });
  global.fetch = jest.fn(
    (_url, { signal }) =>
      new Promise((resolve, reject) => {
        signal.addEventListener("abort", () => reject(new Error("timeout")), { once: true });
        setTimeout(
          () => resolve({ ok: true, text: async () => "timestamp=2026-09-12T20\\:21\\:58Z\nsequenceNumber=4876\n" }),
          DB_REQUEST_TIMEOUT_MS + 1000,
        );
      }),
  );
  try {
    const result = check();
    await jest.advanceTimersByTimeAsync(DB_REQUEST_TIMEOUT_MS + 1000);
    await expect(result).resolves.toMatchObject({ updateAvailable: false });
  } finally {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
    jest.useRealTimers();
  }
});

test("parses escaped timestamps from Geofabrik state.txt", () => {
  const state = parseGeofabrikState(
    "# original OSM minutely replication sequence number 7284053\n" +
      "timestamp=2026-09-12T20\\:21\\:58Z\nsequenceNumber=4876\n",
  );
  expect(state.timestamp.toISOString()).toBe("2026-09-12T20:21:58.000Z");
  expect(state.regionalSequence).toBe("4876");
});

test("rejects invalid upstream timestamps", () => {
  expect(() => parseGeofabrikState("timestamp=invalid\nsequenceNumber=4876\n")).toThrow("Invalid Geofabrik timestamp");
});
