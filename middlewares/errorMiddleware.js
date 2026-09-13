const notFoundHandler = (req, res) => {
  res.status(404).json({ error: `Route not found: ${req.method} ${req.originalUrl}` });
};

const errorHandler = (error, _req, res, _next) => {
  const status = Number.isInteger(error.status) ? error.status : 500;
  const expose = status < 500 || error.expose === true;

  if (status >= 500) console.error(error);

  res.status(status).json({ error: expose ? error.message : "Internal server error" });
};

module.exports = { errorHandler, notFoundHandler };
