const router = require("express").Router();
const adminAuth = require("../middlewares/adminAuthMiddleware");
const controller = require("../controllers/roadIndexUpdateController");

router.use(adminAuth);
router.get("/availability", controller.availability);
router.get("/stats", controller.stats);
router.post("/", controller.create);
router.get("/:jobId", controller.get);

module.exports = router;
