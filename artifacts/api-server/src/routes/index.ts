import { Router, type IRouter } from "express";
import healthRouter from "./health";
import scriptsRouter from "./scripts";
import adminRouter from "./admin";

const router: IRouter = Router();

router.use(healthRouter);
router.use(scriptsRouter);
router.use(adminRouter);

export default router;
