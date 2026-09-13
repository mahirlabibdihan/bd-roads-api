const { DB_DB, DB_HOST, DB_PASS, DB_PGPASSFILE, DB_SSL, DB_PORT, DB_USER } = require("../config/config");
const { readPassword } = require("./pgpass");

const connection = {
  host: DB_HOST,
  port: DB_PORT,
  database: DB_DB,
  user: DB_USER,
  ssl: DB_SSL ? { rejectUnauthorized: true } : false,
};

const databasePassword = async () => DB_PASS || readPassword(DB_PGPASSFILE, connection);

module.exports = { connection, databasePassword };
