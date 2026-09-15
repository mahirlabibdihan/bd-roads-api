let routeService;

const okResponse = (body) => ({ ok: true, status: 200, json: async () => body });

const POINTS = [
  [90.41, 23.81],
  [90.412, 23.812],
];

describe("routeService", () => {
  let originalFetch;

  beforeEach(() => {
    jest.resetModules();
    routeService = require("../services/routeService");
    originalFetch = global.fetch;
  });
  afterEach(() => {
    global.fetch = originalFetch;
  });

  test("asks OSRM for a full, geojson route between fixed waypoints", async () => {
    const geometry = { type: "LineString", coordinates: [POINTS[0], [90.411, 23.8115], POINTS[1]] };
    global.fetch = jest.fn().mockResolvedValue(
      okResponse({
        code: "Ok",
        routes: [{ geometry, distance: 250.4, duration: 180.2 }],
      }),
    );

    const result = await routeService.route({ points: POINTS });

    expect(result).toEqual({
      coordinates: geometry.coordinates,
      distanceMeters: 250.4,
      durationSeconds: 180.2,
      profile: "foot",
    });

    const url = new URL(global.fetch.mock.calls[0][0]);
    expect(url.pathname).toBe("/route/v1/foot/90.41,23.81;90.412,23.812");
    expect(url.searchParams.get("geometries")).toBe("geojson");
    expect(url.searchParams.get("overview")).toBe("full");
    expect(url.searchParams.get("alternatives")).toBe("false");
  });

  test("maps OSRM NoRoute to 422 rather than a generic failure", async () => {
    global.fetch = jest.fn().mockResolvedValue(okResponse({ code: "NoRoute", message: "Impossible route." }));
    await expect(routeService.route({ points: POINTS })).rejects.toMatchObject({
      status: 422,
      code: "NoRoute",
      message: "Impossible route.",
    });
  });

  test("reports an unreachable OSRM as 503", async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error("connect ECONNREFUSED"));
    await expect(routeService.route({ points: POINTS })).rejects.toMatchObject({
      status: 503,
      message: "Routing is temporarily unavailable",
    });
  });

  test("rejects a single point before contacting OSRM", async () => {
    global.fetch = jest.fn();
    await expect(routeService.route({ points: [POINTS[0]] })).rejects.toThrow(/at least two points/);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test("rejects an oversized request before contacting OSRM", async () => {
    global.fetch = jest.fn();
    await expect(routeService.route({ points: Array(26).fill(POINTS[0]) })).rejects.toMatchObject({ status: 400 });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test("opens a cooldown after an upstream failure, independent of the match gate", async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error("timeout"));
    await expect(routeService.route({ points: POINTS })).rejects.toMatchObject({ status: 503, retryAfter: 60 });
    await expect(routeService.route({ points: POINTS })).rejects.toMatchObject({ status: 503, retryAfter: 60 });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
