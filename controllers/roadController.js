const Controller = require("./base");
const roadService = require("../services/roadService");

class RoadController extends Controller {
  inBoundingBox = async (req, res, next) => {
    try {
      res.status(200).json(await roadService.inBoundingBox(req.query));
    } catch (error) {
      next(error);
    }
  };
}

module.exports = new RoadController();
