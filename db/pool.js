const { Pool } = require("pg");
const { DB_REQUEST_TIMEOUT_MS } = require("../config/config");
const { connection, databasePassword } = require("../utils/databaseConfig");

// One shared pool, unlike bpo-postcode-osm's per-service pools. There every DB read was an
// occasional admin/status call; here /api/snap and /api/roads are on the hot path for every
// boundary edit, so a single pool with a real connection budget beats several two-connection ones.
const pool = new Pool({
  ...connection,
  password: databasePassword,
  connectionTimeoutMillis: DB_REQUEST_TIMEOUT_MS,
  idleTimeoutMillis: 10000,
  max: 10,
});

pool.on("error", (error) => {
  console.error("Unexpected road network database error", error);
});

const unavailable = (message) => (cause) => {
  const error = new Error(message, { cause });
  error.status = 503;
  error.expose = true;
  return error;
};

const query = async (text, values) => pool.query(text, values);

module.exports = { pool, query, unavailable };
