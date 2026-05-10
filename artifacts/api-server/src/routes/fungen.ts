import { Router, type Request, type Response } from "express";
import { getAuth, clerkClient } from "@clerk/express";
import { pool } from "../lib/db";

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

/**
 * GET /api/user/preferences
 * Returns the current user's persisted UI preferences from the DB.
 */
router.get("/user/preferences", async (req: Request, res: Response) => {
  const auth = getAuth(req);
  if (!auth.userId) {
    res.status(401).json({ error: "Not authenticated." });
    return;
  }
  try {
    const { rows } = await pool.query(
      `SELECT haptic_ai_warn_dismissed FROM users WHERE clerk_id = $1 LIMIT 1`,
      [auth.userId],
    );
    const hapticAiWarnDismissed = rows.length > 0 ? rows[0].haptic_ai_warn_dismissed === true : false;
    res.json({ hapticAiWarnDismissed });
  } catch {
    res.status(500).json({ error: "Failed to fetch preferences." });
  }
});

/**
 * POST /api/user/preferences
 * Body: { hapticAiWarnDismissed?: boolean }
 * Persists one or more user UI preferences to the DB.
 */
router.post("/user/preferences", async (req: Request, res: Response) => {
  const auth = getAuth(req);
  if (!auth.userId) {
    res.status(401).json({ error: "Not authenticated." });
    return;
  }
  const { hapticAiWarnDismissed } = req.body as { hapticAiWarnDismissed?: unknown };
  if (hapticAiWarnDismissed !== true) {
    res.status(400).json({ error: "No valid preference fields provided." });
    return;
  }
  try {
    await pool.query(
      `UPDATE users SET haptic_ai_warn_dismissed = TRUE WHERE clerk_id = $1`,
      [auth.userId],
    );
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "Failed to save preferences." });
  }
});

export default router;
