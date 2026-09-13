const { query } = require("./pool");

// osm2pgsql-replication records how far into the Geofabrik diff stream the local database has been
// brought. osm2pgsql 1.9 and later keep that in osm2pgsql_properties (property/value rows); older
// builds used osm2pgsql_replication_status (url/sequence/importdate). Ubuntu 24.04 ships 1.11, so
// the first branch is the live one -- the fallback costs a single catalogue lookup and turns a
// bare "relation does not exist" into a working read on an older server.
const PROPERTIES_TABLE = "public.osm2pgsql_properties";
const LEGACY_TABLE = "public.osm2pgsql_replication_status";

const tableExists = async (name) => {
  const result = await query("SELECT to_regclass($1) IS NOT NULL AS present", [name]);
  return result.rows[0]?.present === true;
};

const read = async () => {
  if (await tableExists(PROPERTIES_TABLE)) {
    const result = await query(
      `SELECT property, value
       FROM osm2pgsql_properties
       WHERE property IN ('replication_timestamp', 'replication_sequence_number')`,
    );
    const values = Object.fromEntries(result.rows.map((row) => [row.property, row.value]));
    if (!values.replication_timestamp) {
      throw new Error("osm2pgsql has no replication_timestamp; run osm2pgsql-replication init");
    }
    return {
      timestamp: values.replication_timestamp,
      sequence: values.replication_sequence_number ?? null,
    };
  }

  if (await tableExists(LEGACY_TABLE)) {
    const result = await query("SELECT importdate, sequence FROM osm2pgsql_replication_status LIMIT 1");
    const row = result.rows[0];
    if (!row?.importdate) {
      throw new Error("osm2pgsql has no replication status; run osm2pgsql-replication init");
    }
    return { timestamp: row.importdate, sequence: row.sequence ?? null };
  }

  throw new Error("osm2pgsql replication state is missing; run osm2pgsql-replication init");
};

module.exports = { read };
