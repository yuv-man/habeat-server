import express, { Request, Response, NextFunction, Router } from "express";
import userRouter from "./user/user.route";
import generateRouter from "./generator/generate.route";
import planRouter from "./plan/plan.routes";
import progressRouter from "./progress/progress.routes";
import authRouter from "./auth/auth.route";
interface CustomError extends Error {
  code?: string | number;
}

const router: Router = express.Router();
router
  .use('/api', authRouter)
  .use('/api/users', userRouter)
  .use('/api/generate', generateRouter)
  .use('/api/plan', planRouter)
  .use('/api/progress', progressRouter)
  .use((error: CustomError, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).send({
      code: error.code,
      message: error.message,
    });
  });

export default router;
