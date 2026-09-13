const { readFile, stat } = require("node:fs/promises");

const splitLine = (line) => {
  const fields = [];
  let field = "";
  let escaped = false;

  for (const character of line) {
    if (escaped) {
      field += character;
      escaped = false;
    } else if (character === "\\") {
      escaped = true;
    } else if (character === ":") {
      fields.push(field);
      field = "";
    } else {
      field += character;
    }
  }
  if (escaped) field += "\\";
  fields.push(field);
  return fields;
};

const matches = (actual, expected) => expected === "*" || expected === actual;

const readPassword = async (file, connection) => {
  const fileStat = await stat(file);
  if (process.platform !== "win32" && (fileStat.mode & 0o077) !== 0) {
    throw new Error(`${file} must not be accessible by group or others`);
  }

  const contents = await readFile(file, "utf8");
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const fields = splitLine(line);
    if (fields.length !== 5) continue;
    const [host, port, database, user, password] = fields;
    if (
      matches(connection.host, host) &&
      matches(String(connection.port), port) &&
      matches(connection.database, database) &&
      matches(connection.user, user)
    ) {
      return password;
    }
  }
  throw new Error(`No matching credentials found in ${file}`);
};

module.exports = { readPassword, splitLine };
