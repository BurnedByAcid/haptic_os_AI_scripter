import { Router, type Request, type Response } from "express";
import { getAuth } from "@clerk/express";
import { pool } from "../lib/db";
import { getPlan } from "../lib/getPlan";
import { logger } from "../lib/logger";

const router = Router();

const FREE_DAILY_LIMIT = 2;

/**
 * GET /api/usage/scripter/today
 * Returns how many Scripter sessions the calling user has used today (read-only).
 */
router.get("/usage/scripter/today", async (req: Request, res: Response) => {
  const auth = getAuth(req);
  if (!auth.userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  try {
    const { rows } = await pool.query(
      `SELECT count FROM scripter_usage
       WHERE user_id = $1 AND usage_date = CURRENT_DATE`,
      [auth.userId]
    );
    const count = rows.length > 0 ? (rows[0] as { count: number }).count : 0;
    res.json({ count, limit: FREE_DAILY_LIMIT });
  } catch {
    res.status(500).json({ error: "Failed to fetch usage" });
  }
});

/**
 * POST /api/usage/scripter/start
 * Atomically checks the daily limit and increments the counter in a single transaction.
 * For free users: returns { allowed: false } if the limit (2/day) is already reached.
 * For subscribers/pro/admin: always returns { allowed: true } without touching the counter.
 *
 * This is the authoritative enforcement point — the frontend must call this and
 * respect the result before showing the editor.
 */
router.post("/usage/scripter/start", async (req: Request, res: Response) => {
  const auth = getAuth(req);
  if (!auth.userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  // Check effective plan outside the transaction — getPlan falls back to
  // Clerk metadata so bootstrapped admins are correctly recognised.
  const plan = await getPlan(auth.userId);
  if (plan !== "free") {
    res.json({ allowed: true, count: null, limit: FREE_DAILY_LIMIT });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Re-check inside the transaction with a row-level lock so the counter
    // update is serialised against concurrent requests for the same user.
    const { rows: userRows } = await client.query(
      `SELECT plan FROM users WHERE clerk_id = $1 FOR UPDATE`,
      [auth.userId]
    );
    const lockedPlan = (userRows[0] as { plan: string } | undefined)?.plan ?? "free";

    if (lockedPlan !== "free") {
      await client.query("COMMIT");
      res.json({ allowed: true, count: null, limit: FREE_DAILY_LIMIT });
      return;
    }

    const { rows: usageRows } = await client.query(
      `SELECT count FROM scripter_usage
       WHERE user_id = $1 AND usage_date = CURRENT_DATE`,
      [auth.userId]
    );
    const currentCount = usageRows.length > 0 ? (usageRows[0] as { count: number }).count : 0;

    if (currentCount >= FREE_DAILY_LIMIT) {
      await client.query("COMMIT");
      res.json({ allowed: false, count: currentCount, limit: FREE_DAILY_LIMIT });
      return;
    }

    const { rows: updatedRows } = await client.query(
      `INSERT INTO scripter_usage (user_id, usage_date, count)
       VALUES ($1, CURRENT_DATE, 1)
       ON CONFLICT (user_id, usage_date)
       DO UPDATE SET count = scripter_usage.count + 1
       RETURNING count`,
      [auth.userId]
    );
    const newCount = (updatedRows[0] as { count: number }).count;

    await client.query("COMMIT");
    res.json({ allowed: true, count: newCount, limit: FREE_DAILY_LIMIT });
  } catch (err) {
    await client.query("ROLLBACK");
    logger.error({ err }, "Failed to record usage");
    res.status(500).json({ error: "Failed to record usage" });
  } finally {
    client.release();
  }
});

export default router;
