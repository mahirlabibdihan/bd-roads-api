const router = require("express").Router();
const roadController = require("../controllers/roadController");

router.get("/roads", roadController.inBoundingBox);

module.exports = router;
