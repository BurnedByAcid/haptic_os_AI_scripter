import { Router, type IRouter } from "express";
import healthRouter from "./health";
import scriptsRouter from "./scripts";
import adminRouter from "./admin";
import aiRouter from "./ai";
import usersRouter from "./users";
import billingRouter from "./billing";
import usageRouter from "./usage";

const router: IRouter = Router();

router.use(healthRouter);
router.use(scriptsRouter);
router.use(adminRouter);
router.use(aiRouter);
router.use(usersRouter);
router.use(billingRouter);
router.use(usageRouter);

export default router;
