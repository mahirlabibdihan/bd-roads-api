const { hasNewState, parseSequence } = require("../utils/replicationSequence");

describe("osm2pgsql replication state", () => {
  test("compares sequence numbers beyond Number.MAX_SAFE_INTEGER", () => {
    expect(parseSequence("9007199254740993")).toBe(9007199254740993n);
    expect(hasNewState({ sequence: "9007199254740992" }, { sequence: "9007199254740993" })).toBe(true);
  });

  test("treats an unchanged sequence as no update", () => {
    expect(hasNewState({ sequence: "5000" }, { sequence: "5000" })).toBe(false);
  });

  test("falls back to the timestamp when no sequence has been recorded yet", () => {
    const before = { sequence: null, timestamp: "2026-09-01T00:00:00Z" };
    const after = { sequence: null, timestamp: "2026-09-02T00:00:00Z" };
    expect(hasNewState(before, after)).toBe(true);
    expect(hasNewState(after, before)).toBe(false);
  });

  test("rejects a non-numeric sequence rather than silently comparing strings", () => {
    expect(() => parseSequence("not-a-sequence")).toThrow(/Invalid osm2pgsql replication sequence/);
  });
});
