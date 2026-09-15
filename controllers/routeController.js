const Controller = require("./base");
const routeService = require("../services/routeService");

class RouteController extends Controller {
  route = async (req, res, next) => {
    try {
      res.status(200).json(await routeService.route(req.body || {}));
    } catch (error) {
      next(error);
    }
  };
}

module.exports = new RouteController();
