import { Router, type Request, type Response } from "express";
import { getAuth, clerkClient } from "@clerk/express";

const router = Router();

/**
 * GET /api/user/fungen-status
 * Returns whether the current user has accepted the FunGen EUA.
 */
router.get("/user/fungen-status", async (req: Request, res: Response) => {
  const auth = getAuth(req);
  if (!auth.userId) {
    res.status(401).json({ error: "Not authenticated." });
    return;
  }
  try {
    const user = await clerkClient.users.getUser(auth.userId);
    const agreed = (user.publicMetadata as Record<string, unknown>)?.fungenAgreed === true;
    res.json({ agreed });
  } catch {
    res.status(500).json({ error: "Failed to fetch user status." });
  }
});

/**
 * POST /api/user/fungen-agree
 * Records that the current user has accepted the FunGen EUA.
 * Idempotent — calling it again when already agreed is a no-op.
 */
router.post("/user/fungen-agree", async (req: Request, res: Response) => {
  const auth = getAuth(req);
  if (!auth.userId) {
    res.status(401).json({ error: "Not authenticated." });
    return;
  }
  try {
    await clerkClient.users.updateUserMetadata(auth.userId, {
      publicMetadata: { fungenAgreed: true },
    });
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "Failed to record agreement." });
  }
});

export default router;
