import { Router, type IRouter } from "express";
import healthRouter from "./health";
import scriptsRouter from "./scripts";
import adminRouter from "./admin";
import aiRouter from "./ai";
import usersRouter from "./users";

const router: IRouter = Router();

router.use(healthRouter);
router.use(scriptsRouter);
router.use(adminRouter);
router.use(aiRouter);
router.use(usersRouter);

export default router;
