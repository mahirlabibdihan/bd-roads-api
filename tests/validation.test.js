const { parseBbox, parseClasses, parsePoints, parseRadius } = require("../utils/validation");

describe("request validation", () => {
  test("parses a well-formed bbox", () => {
    expect(parseBbox("90.3,23.7,90.5,23.9", 0.5)).toEqual({
      minLon: 90.3,
      minLat: 23.7,
      maxLon: 90.5,
      maxLat: 23.9,
    });
  });

  test("rejects an inverted bbox", () => {
    expect(() => parseBbox("90.5,23.7,90.3,23.9", 0.5)).toThrow(/minLon must be less than maxLon/);
  });

  test("rejects a bbox larger than the configured span", () => {
    expect(() => parseBbox("88.0,23.0,92.0,23.5", 0.5)).toThrow(/may not span more than 0.5 degrees/);
  });

  test("treats an absent classes filter as every class", () => {
    expect(parseClasses(undefined)).toBeNull();
    expect(parseClasses("")).toBeNull();
  });

  test("normalizes and validates highway classes", () => {
    expect(parseClasses("Residential, TRACK ")).toEqual(["residential", "track"]);
    expect(() => parseClasses("residential;drop")).toThrow(/Invalid highway class/);
  });

  test("caps the snap radius", () => {
    expect(parseRadius(undefined, { fallback: 50, max: 500 })).toBe(50);
    expect(parseRadius("120", { fallback: 50, max: 500 })).toBe(120);
    expect(() => parseRadius("900", { fallback: 50, max: 500 })).toThrow(/may not exceed 500/);
    expect(() => parseRadius("0", { fallback: 50, max: 500 })).toThrow(/greater than 0/);
  });

  test("splits points into the parallel arrays PostGIS and OSRM each want", () => {
    expect(
      parsePoints(
        [
          [90.4, 23.8],
          [90.41, 23.81],
        ],
        10,
      ),
    ).toEqual({
      lons: [90.4, 90.41],
      lats: [23.8, 23.81],
    });
  });

  test("reports which point is malformed", () => {
    expect(() => parsePoints([[90.4, 23.8], [90.41]], 10)).toThrow(/points\[1\] must be a/);
    expect(() => parsePoints([[90.4, 200]], 10)).toThrow(/points\[0\]\[1\] must be between -90 and 90/);
  });

  test("enforces the point-count cap", () => {
    expect(() =>
      parsePoints(
        [
          [90, 23],
          [90, 23],
        ],
        1,
      ),
    ).toThrow(/more than 1 entries/);
  });
});
