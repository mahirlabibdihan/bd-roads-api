const Controller = require("./base");
const snapService = require("../services/snapService");

class SnapController extends Controller {
  point = async (req, res, next) => {
    try {
      res.status(200).json(await snapService.point(req.query));
    } catch (error) {
      next(error);
    }
  };

  path = async (req, res, next) => {
    try {
      res.status(200).json(await snapService.path(req.body || {}));
    } catch (error) {
      next(error);
    }
  };
}

module.exports = new SnapController();
