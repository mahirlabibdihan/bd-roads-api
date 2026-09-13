const { timingSafeEqual } = require("node:crypto");
const { ROAD_INDEX_ADMIN_TOKEN } = require("../config/config");

module.exports = (req, _res, next) => {
  const supplied = req.get("Authorization")?.replace(/^Bearer\s+/i, "") || "";
  const expected = ROAD_INDEX_ADMIN_TOKEN;
  const valid =
    supplied.length === expected.length &&
    expected.length > 0 &&
    timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));

  if (!valid) {
    const error = new Error("Unauthorized");
    error.status = 401;
    return next(error);
  }
  return next();
};
