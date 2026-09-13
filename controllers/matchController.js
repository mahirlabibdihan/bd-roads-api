const Controller = require("./base");
const matchService = require("../services/matchService");

class MatchController extends Controller {
  match = async (req, res, next) => {
    try {
      res.status(200).json(await matchService.match(req.body || {}));
    } catch (error) {
      next(error);
    }
  };
}

module.exports = new MatchController();
