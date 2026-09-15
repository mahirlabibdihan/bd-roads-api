const router = require("express").Router();
const routeController = require("../controllers/routeController");

router.post("/route", routeController.route);

module.exports = router;
