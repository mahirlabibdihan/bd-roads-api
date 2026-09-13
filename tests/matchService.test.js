const matchService = require("../services/matchService");

const okResponse = (body) => ({ ok: true, status: 200, json: async () => body });

const TRACE = [
  [90.41, 23.81],
  [90.411, 23.811],
  [90.412, 23.812],
];

describe("matchService", () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });
  afterEach(() => {
    global.fetch = originalFetch;
  });

  test("asks OSRM for a tidied, gap-tolerant GeoJSON match", async () => {
    global.fetch = jest.fn().mockResolvedValue(
      okResponse({
        code: "Ok",
        matchings: [
          {
            confidence: 0.87,
            distance: 412.3,
            duration: 300.1,
            geometry: { type: "LineString", coordinates: TRACE },
          },
        ],
        tracepoints: TRACE.map((location, index) => ({
          location,
          distance: 3.2,
          matchings_index: 0,
          waypoint_index: index,
          name: "Mirpur Road",
        })),
      }),
    );

    const result = await matchService.match({ points: TRACE, radius: 25 });

    expect(result.matchings[0]).toEqual({
      confidence: 0.87,
      distanceMeters: 412.3,
      durationSeconds: 300.1,
      geometry: { type: "LineString", coordinates: TRACE },
    });
    expect(result.unmatchedCount).toBe(0);
    expect(result.profile).toBe("foot");

    const url = new URL(global.fetch.mock.calls[0][0]);
    expect(url.pathname).toBe("/match/v1/foot/90.41,23.81;90.411,23.811;90.412,23.812");
    expect(url.searchParams.get("geometries")).toBe("geojson");
    expect(url.searchParams.get("overview")).toBe("full");
    // A boundary walk is one route: a GPS dropout must not split it into separate matchings.
    expect(url.searchParams.get("gaps")).toBe("ignore");
    expect(url.searchParams.get("tidy")).toBe("true");
    expect(url.searchParams.get("radiuses")).toBe("25;25;25");
  });

  test("keeps nulls for fixes OSRM could not place, preserving input alignment", async () => {
    global.fetch = jest.fn().mockResolvedValue(
      okResponse({
        code: "Ok",
        matchings: [],
        tracepoints: [{ location: [90.41, 23.81], distance: 2, matchings_index: 0, waypoint_index: 0 }, null, null],
      }),
    );

    const result = await matchService.match({ points: TRACE });
    expect(result.pointCount).toBe(3);
    expect(result.unmatchedCount).toBe(2);
    expect(result.tracepoints[1]).toBeNull();
    expect(result.tracepoints[0].name).toBeNull();
  });

  test("maps OSRM NoMatch to 422 rather than a generic failure", async () => {
    global.fetch = jest.fn().mockResolvedValue(okResponse({ code: "NoMatch", message: "Could not match the trace." }));
    await expect(matchService.match({ points: TRACE })).rejects.toMatchObject({
      status: 422,
      code: "NoMatch",
      message: "Could not match the trace.",
    });
  });

  test("reports an unreachable OSRM as 503", async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error("connect ECONNREFUSED"));
    await expect(matchService.match({ points: TRACE })).rejects.toMatchObject({
      status: 503,
      message: "Map matching is temporarily unavailable",
    });
  });

  test("validates timestamps against the point count before calling OSRM", async () => {
    global.fetch = jest.fn();
    await expect(matchService.match({ points: TRACE, timestamps: [1, 2] })).rejects.toThrow(/one per point/);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test("passes timestamps through when they line up", async () => {
    global.fetch = jest.fn().mockResolvedValue(okResponse({ code: "Ok", matchings: [], tracepoints: [] }));
    await matchService.match({ points: TRACE, timestamps: [1700000000, 1700000005, 1700000010] });
    const url = new URL(global.fetch.mock.calls[0][0]);
    expect(url.searchParams.get("timestamps")).toBe("1700000000;1700000005;1700000010");
  });
});
