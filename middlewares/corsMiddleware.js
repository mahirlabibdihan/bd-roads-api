const { CORS_ALLOWED_ORIGINS } = require("../config/config");

const cors = (req, res, next) => {
  const origin = req.get("Origin");
  if (origin && CORS_ALLOWED_ORIGINS.includes(origin)) {
    res.set("Access-Control-Allow-Origin", origin);
    res.set("Vary", "Origin");
    res.set("Access-Control-Allow-Headers", "Authorization, Content-Type, Idempotency-Key");
    res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  }

  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
};

module.exports = cors;
