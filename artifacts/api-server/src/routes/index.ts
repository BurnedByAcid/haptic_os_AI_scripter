import { Router, type IRouter } from "express";
import scriptsRouter from "./scripts";
import adminRouter from "./admin";
import usersRouter from "./users";
import billingRouter from "./billing";
import usageRouter from "./usage";
import mediaFunscriptsRouter from "./media-funscripts";
import communityRouter from "./community";
import blockReportsRouter from "./block-reports";
import scripterDraftsRouter from "./scripter-drafts";
import scripterSessionsRouter from "./scripter-sessions";
import analyticsRouter from "./analytics";
import videoRouter from "./video";
import hapticaiRouter from "./hapticai";
import aiscripterRouter from "./aiscripter";

const router: IRouter = Router();

router.use(scriptsRouter);
router.use(adminRouter);
router.use(usersRouter);
router.use(billingRouter);
router.use(usageRouter);
router.use(mediaFunscriptsRouter);
router.use(communityRouter);
router.use(blockReportsRouter);
router.use(scripterDraftsRouter);
router.use(scripterSessionsRouter);
router.use(analyticsRouter);
router.use(videoRouter);
router.use(hapticaiRouter);
router.use(aiscripterRouter);

export default router;
