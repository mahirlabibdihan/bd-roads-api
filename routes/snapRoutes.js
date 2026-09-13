const router = require("express").Router();
const snapController = require("../controllers/snapController");

// POST rather than GET for the ring: a whole boundary does not fit a query string, and these are
// reads with no side effects either way.
router.post("/snap/path", snapController.path);
router.get("/snap", snapController.point);

module.exports = router;
