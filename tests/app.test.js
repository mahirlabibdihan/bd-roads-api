const request = require("supertest");

jest.mock("../db/pool", () => ({
  query: jest.fn(),
  unavailable: (message) => (cause) => {
    const error = new Error(message, { cause });
    error.status = 503;
    error.expose = true;
    return error;
  },
}));

jest.mock("../services/healthService", () => ({ readiness: jest.fn() }));

const { query } = require("../db/pool");
const healthService = require("../services/healthService");
const { app } = require("../app");

const healthy = {
  status: "ok",
  dependencies: { roads: "up", osrm: "up" },
  features: { roadExtract: "enabled", snapping: "enabled", mapMatching: "enabled", roadIndexUpdates: "enabled" },
};

describe("API", () => {
  beforeEach(() => {
    query.mockReset();
    healthService.readiness.mockResolvedValue(healthy);
  });

  test("reports service health", async () => {
    const response = await request(app).get("/api/health");
    expect(response.status).toBe(200);
    expect(response.body).toEqual(healthy);
  });

  test("stays healthy when only OSRM is down, since snapping still works", async () => {
    healthService.readiness.mockResolvedValue({ ...healthy, status: "degraded" });
    const response = await request(app).get("/api/health");
    expect(response.status).toBe(200);
    expect(response.body.status).toBe("degraded");
  });

  test("reports 503 when the road database itself is down", async () => {
    healthService.readiness.mockResolvedValue({ ...healthy, status: "unavailable" });
    expect((await request(app).get("/api/health")).status).toBe(503);
  });

  test("allows the configured frontend origin", async () => {
    const response = await request(app).options("/api/roads").set("Origin", "http://127.0.0.1:5173");
    expect(response.status).toBe(204);
    expect(response.headers["access-control-allow-origin"]).toBe("http://127.0.0.1:5173");
  });

  test("returns road geometry as GeoJSON for a bbox", async () => {
    query.mockResolvedValue({
      rows: [
        {
          way_id: "99",
          highway: "track",
          name: null,
          name_bn: null,
          ref: null,
          surface: "unpaved",
          bridge: false,
          tunnel: false,
          geometry: {
            type: "LineString",
            coordinates: [
              [90.4, 23.8],
              [90.41, 23.81],
            ],
          },
        },
      ],
    });

    const response = await request(app).get("/api/roads?bbox=90.3,23.7,90.5,23.9&classes=track");
    expect(response.status).toBe(200);
    expect(response.body.type).toBe("FeatureCollection");
    expect(response.body.features[0].properties).toMatchObject({ osmId: 99, highway: "track", name: null });
    expect(response.body.truncated).toBe(false);
  });

  test("flags a truncated bbox response so callers do not snap against a partial network", async () => {
    query.mockResolvedValue({
      rows: [{ way_id: "1", highway: "residential", geometry: { type: "LineString", coordinates: [] } }],
    });
    const response = await request(app).get("/api/roads?bbox=90.3,23.7,90.5,23.9&limit=1");
    expect(response.body.truncated).toBe(true);
  });

  test("requires a bbox", async () => {
    const response = await request(app).get("/api/roads");
    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/bbox is required/);
  });

  test("rejects a bbox that would pull most of the country", async () => {
    const response = await request(app).get("/api/roads?bbox=88.0,21.0,92.5,26.0");
    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/may not span more than/);
  });

  test("validates snap coordinates", async () => {
    expect((await request(app).get("/api/snap?lat=23.8")).status).toBe(400);
    expect((await request(app).get("/api/snap?lat=23.8&lon=abc")).status).toBe(400);
  });

  test("rejects an empty snap path body", async () => {
    const response = await request(app).post("/api/snap/path").send({ points: [] });
    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/non-empty array/);
  });

  test("accepts a boundary ring far larger than the old 32kb body cap", async () => {
    const points = Array.from({ length: 1500 }, (_, index) => [90.4 + index / 100000, 23.8 + index / 100000]);
    query.mockResolvedValue({ rows: points.map(() => ({ way_id: null, lon: null, lat: null })) });

    const response = await request(app).post("/api/snap/path").send({ points });
    expect(response.status).toBe(200);
    expect(response.body.pointCount).toBe(1500);
    expect(response.body.unsnappedCount).toBe(1500);
  });

  test("protects the background-update API", async () => {
    const response = await request(app).post("/api/admin/update");
    expect([401, 503]).toContain(response.status);
  });

  test("returns JSON for unknown routes", async () => {
    const response = await request(app).get("/api/missing");
    expect(response.status).toBe(404);
    expect(response.body.error).toMatch(/Route not found/);
  });
});
