jest.mock("../db/pool", () => ({
  query: jest.fn(),
  unavailable: (message) => (cause) => {
    const error = new Error(message, { cause });
    error.status = 503;
    error.expose = true;
    return error;
  },
}));

const { query } = require("../db/pool");
const snapService = require("../services/snapService");

const roadRow = {
  way_id: "4242",
  highway: "residential",
  name: "Mirpur Road",
  name_bn: null,
  lon: 90.4126,
  lat: 23.8104,
  distance_m: 11.4,
};

describe("snapService", () => {
  beforeEach(() => query.mockReset());

  test("returns the closest point on the nearest road", async () => {
    query.mockResolvedValue({ rows: [roadRow] });
    const result = await snapService.point({ lat: "23.8103", lon: "90.4125" });

    expect(result.snapped).toEqual({
      coordinates: [90.4126, 23.8104],
      distanceMeters: 11.4,
      road: { osmId: 4242, osmType: "W", highway: "residential", name: "Mirpur Road", nameBn: null },
    });
    expect(result.radiusMeters).toBe(50);
    // longitude first, matching the [lon, lat] order the frontend and PostGIS both use
    expect(query.mock.calls[0][1].slice(0, 2)).toEqual([90.4125, 23.8103]);
  });

  test("reports no road nearby as a normal answer rather than an error", async () => {
    // LEFT JOIN LATERAL yields a row of nulls when nothing is inside the radius.
    query.mockResolvedValue({ rows: [{ way_id: null, lon: null, lat: null, distance_m: null }] });
    const result = await snapService.point({ lat: "23.8103", lon: "90.4125", radius: "10" });

    expect(result.snapped).toBeNull();
    expect(result.input).toEqual([90.4125, 23.8103]);
    expect(result.radiusMeters).toBe(10);
  });

  test("keeps unsnappable vertices in place so the caller can tell which failed", async () => {
    query.mockResolvedValue({
      rows: [roadRow, { way_id: null, lon: null, lat: null, distance_m: null }, roadRow],
    });
    const result = await snapService.path({
      points: [
        [90.41, 23.81],
        [91.9, 21.2],
        [90.42, 23.82],
      ],
    });

    expect(result.pointCount).toBe(3);
    expect(result.unsnappedCount).toBe(1);
    expect(result.snapped[1]).toBeNull();
    expect(result.snapped[2].road.osmId).toBe(4242);
  });

  test("sends the ring as parallel lon/lat arrays in one round trip", async () => {
    query.mockResolvedValue({ rows: [] });
    await snapService.path({
      points: [
        [90.41, 23.81],
        [90.42, 23.82],
      ],
      classes: "residential,track",
    });

    expect(query).toHaveBeenCalledTimes(1);
    const [lons, lats, radius, classes] = query.mock.calls[0][1];
    expect(lons).toEqual([90.41, 90.42]);
    expect(lats).toEqual([23.81, 23.82]);
    expect(radius).toBe(50);
    expect(classes).toEqual(["residential", "track"]);
  });

  test("rejects a bad coordinate before touching the database", async () => {
    await expect(snapService.point({ lat: "95", lon: "90.4" })).rejects.toThrow(/lat must be between/);
    expect(query).not.toHaveBeenCalled();
  });

  test("surfaces a database failure as 503", async () => {
    query.mockRejectedValue(new Error("connection refused"));
    await expect(snapService.point({ lat: "23.8", lon: "90.4" })).rejects.toMatchObject({
      status: 503,
      message: "Road snapping is temporarily unavailable",
    });
  });
});
