import { Router, type IRouter } from "express";
import healthRouter from "./health";
import scriptsRouter from "./scripts";
import adminRouter from "./admin";
import usersRouter from "./users";
import billingRouter from "./billing";
import usageRouter from "./usage";
import libraryRouter from "./library";
import mediaFunscriptsRouter from "./media-funscripts";
import communityRouter from "./community";
import blockReportsRouter from "./block-reports";
import scripterDraftsRouter from "./scripter-drafts";
import scripterSessionsRouter from "./scripter-sessions";

const router: IRouter = Router();

router.use(healthRouter);
router.use(scriptsRouter);
router.use(adminRouter);
router.use(usersRouter);
router.use(billingRouter);
router.use(usageRouter);
router.use(libraryRouter);
router.use(mediaFunscriptsRouter);
router.use(communityRouter);
router.use(blockReportsRouter);
router.use(scripterDraftsRouter);
router.use(scripterSessionsRouter);

export default router;
