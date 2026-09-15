const express = require("express");
const healthRoutes = require("./routes/healthRoutes");
const roadRoutes = require("./routes/roadRoutes");
const snapRoutes = require("./routes/snapRoutes");
const matchRoutes = require("./routes/matchRoutes");
const routeRoutes = require("./routes/routeRoutes");
const roadIndexUpdateRoutes = require("./routes/roadIndexUpdateRoutes");
const { errorHandler, notFoundHandler } = require("./middlewares/errorMiddleware");
const cors = require("./middlewares/corsMiddleware");

const app = express();
app.disable("x-powered-by");
app.use(cors);
// A 2,000-point boundary ring is roughly 50 KB of JSON, so the 32 KB cap bpo-postcode-osm uses
// for its short search queries is far too small here. SNAP_MAX_POINTS is the real limit.
app.use(express.json({ limit: "1mb" }));
app.use("/api", healthRoutes);
app.use("/api", roadRoutes);
app.use("/api", snapRoutes);
app.use("/api", matchRoutes);
app.use("/api", routeRoutes);
app.use("/api/admin/update", roadIndexUpdateRoutes);
app.use(notFoundHandler);
app.use(errorHandler);

module.exports = { app };
