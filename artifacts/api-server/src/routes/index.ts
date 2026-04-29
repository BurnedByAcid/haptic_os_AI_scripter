import { Router, type IRouter } from "express";
import healthRouter from "./health";
import scriptsRouter from "./scripts";

const router: IRouter = Router();

router.use(healthRouter);
router.use(scriptsRouter);

export default router;
