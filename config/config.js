require("dotenv").config();

const numberFromEnv = (name, fallback) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
};

const withoutTrailingSlash = (value) => value.replace(/\/+$/, "");
const OSRM_BASE_URL = withoutTrailingSlash(process.env.OSRM_BASE_URL || "http://127.0.0.1:5010");
const OSM_REPLICATION_URL = withoutTrailingSlash(
  process.env.OSM_REPLICATION_URL || "https://download.geofabrik.de/asia/bangladesh-updates",
);

module.exports = {
  NODE_ENV: process.env.NODE_ENV || "development",
  HOST: process.env.HOST || "127.0.0.1",
  PORT: numberFromEnv("PORT", 5002),
  CORS_ALLOWED_ORIGINS: (process.env.CORS_ALLOWED_ORIGINS || "http://127.0.0.1:5173,http://localhost:5173")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),

  ROADS_MAX_BBOX_DEGREES: numberFromEnv("ROADS_MAX_BBOX_DEGREES", 0.5),
  ROADS_DEFAULT_LIMIT: numberFromEnv("ROADS_DEFAULT_LIMIT", 2000),
  ROADS_MAX_LIMIT: numberFromEnv("ROADS_MAX_LIMIT", 10000),

  SNAP_DEFAULT_RADIUS_METERS: numberFromEnv("SNAP_DEFAULT_RADIUS_METERS", 50),
  SNAP_MAX_RADIUS_METERS: numberFromEnv("SNAP_MAX_RADIUS_METERS", 500),
  SNAP_MAX_POINTS: numberFromEnv("SNAP_MAX_POINTS", 2000),

  OSRM_BASE_URL,
  OSRM_PROFILE: process.env.OSRM_PROFILE || "foot",
  OSRM_MAX_MATCHING_SIZE: numberFromEnv("OSRM_MAX_MATCHING_SIZE", 1000),
  OSRM_REQUEST_TIMEOUT_MS: numberFromEnv("OSRM_REQUEST_TIMEOUT_MS", 10000),

  DB_REQUEST_TIMEOUT_MS: numberFromEnv("DB_REQUEST_TIMEOUT_MS", 5000),
  GEOFABRIK_REQUEST_TIMEOUT_MS: numberFromEnv("GEOFABRIK_REQUEST_TIMEOUT_MS", 15000),
  DB_USER: process.env.DB_USER || "roads_api",
  DB_HOST: process.env.DB_HOST || "127.0.0.1",
  DB_PASS: process.env.DB_PASS || "",
  DB_DB: process.env.DB_DB || "roads",
  DB_PORT: numberFromEnv("DB_PORT", 5432),
  DB_SSL: process.env.DB_SSL === "true",
  DB_PGPASSFILE: process.env.DB_PGPASSFILE || "/srv/road-network/.pgpass",

  REDIS_URL: process.env.REDIS_URL || "redis://127.0.0.1:6379/1",
  REDIS_CONNECT_TIMEOUT_MS: numberFromEnv("REDIS_CONNECT_TIMEOUT_MS", 1000),
  ROAD_INDEX_ADMIN_TOKEN: process.env.ROAD_INDEX_ADMIN_TOKEN || "",
  ROAD_INDEX_UPDATE_ENABLED: process.env.ROAD_INDEX_UPDATE_ENABLED !== "false",
  ROAD_INDEX_UPDATE_TIMEOUT_SECONDS: numberFromEnv("ROAD_INDEX_UPDATE_TIMEOUT_SECONDS", 7200),
  ROAD_INDEX_OSRM_REBUILD_ENABLED: process.env.ROAD_INDEX_OSRM_REBUILD_ENABLED === "true",

  ROADS_HOME: process.env.ROADS_HOME || "/srv/road-network",
  ROADS_DB_USER: process.env.ROADS_DB_USER || "roads_import",
  OSM2PGSQL_BIN: process.env.OSM2PGSQL_BIN || "osm2pgsql",
  OSM2PGSQL_REPLICATION_BIN: process.env.OSM2PGSQL_REPLICATION_BIN || "osm2pgsql-replication",
  OSM2PGSQL_STYLE: process.env.OSM2PGSQL_STYLE || require("node:path").join(__dirname, "..", "osm2pgsql", "roads.lua"),
  OSRM_BUILD_SCRIPT:
    process.env.OSRM_BUILD_SCRIPT || require("node:path").join(__dirname, "..", "scripts", "build-osrm.sh"),
  ROADS_UPDATE_SCRIPT:
    process.env.ROADS_UPDATE_SCRIPT || require("node:path").join(__dirname, "..", "scripts", "update-roads.sh"),
  ROADS_ENV_FILE: process.env.ROADS_ENV_FILE || require("node:path").join(__dirname, "..", ".env"),
  ROADS_PGPASSFILE: process.env.ROADS_PGPASSFILE || "/srv/road-network/import.pgpass",
  OSM_REPLICATION_URL,
  GEOFABRIK_REPLICATION_STATE_URL: `${OSM_REPLICATION_URL}/state.txt`,
  OSRM_MATCH_URL: `${OSRM_BASE_URL}/match/v1`,
};
