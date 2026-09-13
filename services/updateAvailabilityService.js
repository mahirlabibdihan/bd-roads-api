const { GEOFABRIK_REQUEST_TIMEOUT_MS, GEOFABRIK_REPLICATION_STATE_URL } = require("../config/config");
const replicationState = require("../db/replicationState");

const parseTimestamp = (value, source) => {
  const date = value instanceof Date ? value : new Date(String(value).trim().replaceAll("\\:", ":"));
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid ${source} timestamp`);
  return date;
};

// Geofabrik's state.txt is a Java properties file, so ':' inside the timestamp arrives escaped
// as '\:'. Same parser as bpo-postcode-osm uses against the same feed.
const parseGeofabrikState = (text) => {
  const timestamp = String(text).match(/^timestamp=(.+)\s*$/m)?.[1];
  const regionalSequence = String(text).match(/^sequenceNumber=(\d+)\s*$/m)?.[1];
  if (!timestamp || !regionalSequence) {
    throw new Error("Geofabrik state is missing timestamp or sequence number");
  }
  return { timestamp: parseTimestamp(timestamp, "Geofabrik"), regionalSequence };
};

const getRemoteState = async () => {
  const response = await fetch(GEOFABRIK_REPLICATION_STATE_URL, {
    headers: { accept: "text/plain" },
    signal: AbortSignal.timeout(GEOFABRIK_REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Geofabrik returned HTTP ${response.status}`);
  return parseGeofabrikState(await response.text());
};

exports.check = async () => {
  try {
    const [local, remote] = await Promise.all([replicationState.read(), getRemoteState()]);
    const localTimestamp = parseTimestamp(local.timestamp, "osm2pgsql replication");
    return {
      updateAvailable: remote.timestamp > localTimestamp,
      localDataTimestamp: localTimestamp.toISOString(),
      localSequence: local.sequence === null ? null : String(local.sequence),
      remoteDataTimestamp: remote.timestamp.toISOString(),
      remoteRegionalSequence: remote.regionalSequence,
      checkedAt: new Date().toISOString(),
    };
  } catch (cause) {
    const error = new Error("Update availability is temporarily unavailable", { cause });
    error.status = 503;
    error.expose = true;
    throw error;
  }
};

exports.parseGeofabrikState = parseGeofabrikState;
