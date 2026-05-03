import { Router, type IRouter } from "express";
import healthRouter from "./health";
import scriptsRouter from "./scripts";
import adminRouter from "./admin";
import aiRouter from "./ai";
import usersRouter from "./users";
import billingRouter from "./billing";
import usageRouter from "./usage";
import libraryRouter from "./library";
import communityRouter from "./community";
import blockReportsRouter from "./block-reports";
import scripterDraftsRouter from "./scripter-drafts";

const router: IRouter = Router();

router.use(healthRouter);
router.use(scriptsRouter);
router.use(adminRouter);
router.use(aiRouter);
router.use(usersRouter);
router.use(billingRouter);
router.use(usageRouter);
router.use(libraryRouter);
router.use(communityRouter);
router.use(blockReportsRouter);
router.use(scripterDraftsRouter);

export default router;
