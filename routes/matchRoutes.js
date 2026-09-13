const router = require("express").Router();
const matchController = require("../controllers/matchController");

router.post("/match", matchController.match);

module.exports = router;
