import express from "express";
import { User } from "./user.model";
import { protect } from "../middleware/auth.middleware";
import { getUserFavorites, updateUserFavorites } from "./user.controller";

const router = express.Router();
//const BASE_PATH = "/users";

router
  .route("/")
  // find all
  .get((_req, res, next) => {
    User.find()
      .lean()
      .then((users) => res.send(users))
      .catch(next);
  })
  // create new
  .post((req, res, next) => {
    User.create(req.body)
      .then((user) => res.send(user))
      .catch(next);
  });

router
  .route(`/search`)
  // search
  .post((req, res, next) => {
    User.find(req.body)
      .lean()
      .then((users) => res.send(users))
      .catch(next);
  });

router
  .route(`/:id`)
  // get one
  .get((req, res, next) => {
    User.findById(req.params.id)
      .lean()
      .orFail()
      .then((user) => res.send(user))
      .catch(next);
  })
  // update
  .put((req, res, next) => {
    User.findByIdAndUpdate(req.params.id, req.body, { new: true })
      .lean()
      .orFail()
      .then((user) => res.send(user))
      .catch(next);
  })
  // delete
  .delete((req, res, next) => {
    User.findByIdAndDelete(req.params.id)
      .lean()
      .orFail()
      .then(() => res.send(req.params))
      .catch(next);
  });

router.get(`/:userId/favorites`, protect, getUserFavorites);
router.put(`/:userId/favorites`, protect, updateUserFavorites)

export default router;
