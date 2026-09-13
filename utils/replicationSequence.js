const parseSequence = (value) => {
  const sequence = String(value).trim();
  if (!/^\d+$/.test(sequence)) {
    throw new Error(`Invalid osm2pgsql replication sequence: ${sequence || "empty"}`);
  }
  return BigInt(sequence);
};

const parseTimestamp = (value) => {
  const date = value instanceof Date ? value : new Date(String(value).trim());
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid osm2pgsql replication timestamp: ${value}`);
  return date;
};

// Sequence numbers are the precise signal, but osm2pgsql only records one once
// osm2pgsql-replication has run; the timestamp is always present. Falling back to it keeps a
// first update after a fresh import from being misread as "nothing changed".
const hasNewState = (before, after) => {
  if (before?.sequence != null && after?.sequence != null) {
    return parseSequence(after.sequence) > parseSequence(before.sequence);
  }
  return parseTimestamp(after.timestamp) > parseTimestamp(before.timestamp);
};

module.exports = { hasNewState, parseSequence, parseTimestamp };
