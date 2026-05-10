import { Router, type Request, type Response } from "express";
import { getAuth, clerkClient } from "@clerk/express";
import { pool } from "../lib/db";

const router = Router();

/**
 * GET /api/user/hapticai-status
 * Returns whether the current user has accepted the HapticAI EUA.
 */
router.get("/user/hapticai-status", async (req: Request, res: Response) => {
  const auth = getAuth(req);
  if (!auth.userId) {
    res.status(401).json({ error: "Not authenticated." });
    return;
  }
  try {
    const user = await clerkClient.users.getUser(auth.userId);
    const meta = user.publicMetadata as Record<string, unknown>;
    const agreed = meta?.hapticaiAgreed === true || meta?.fungenAgreed === true;
    res.json({ agreed });
  } catch {
    res.status(500).json({ error: "Failed to fetch user status." });
  }
});

/**
 * POST /api/user/hapticai-agree
 * Records that the current user has accepted the HapticAI EUA.
 * Idempotent — calling it again when already agreed is a no-op.
 */
router.post("/user/hapticai-agree", async (req: Request, res: Response) => {
  const auth = getAuth(req);
  if (!auth.userId) {
    res.status(401).json({ error: "Not authenticated." });
    return;
  }
  try {
    await clerkClient.users.updateUserMetadata(auth.userId, {
      publicMetadata: { hapticaiAgreed: true },
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
  if (hapticAiWarnDismissed !== true && hapticAiWarnDismissed !== false) {
    res.status(400).json({ error: "No valid preference fields provided." });
    return;
  }
  try {
    await pool.query(
      `UPDATE users SET haptic_ai_warn_dismissed = $2 WHERE clerk_id = $1`,
      [auth.userId, hapticAiWarnDismissed],
    );
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "Failed to save preferences." });
  }
});

export default router;
