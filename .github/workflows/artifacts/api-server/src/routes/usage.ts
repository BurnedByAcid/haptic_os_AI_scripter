import { Router, type Request, type Response } from "express";
import { getAuth } from "@clerk/express";
import { pool } from "../lib/db";
import { getPlan } from "../lib/getPlan";
import { logger } from "../lib/logger";

const router = Router();

const FREE_GENERATION_WINDOW_MS = 23 * 60 * 60 * 1000; // 23 hours rolling

/**
 * GET /api/usage/scripter/today
 * Returns whether the calling free user can auto-generate right now,
 * and when the window resets. Subscribers always get { canGenerate: true }.
 * Public shape: { canGenerate: boolean; nextAllowedAt: string | null }
 */
router.get("/usage/scripter/today", async (req: Request, res: Response) => {
  const auth = getAuth(req);
  if (!auth.userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  try {
    const plan = await getPlan(auth.userId);
    if (plan !== "free") {
      res.json({ canGenerate: true, nextAllowedAt: null });
      return;
    }

    const { rows } = await pool.query(
      `SELECT last_generation_at FROM users WHERE clerk_id = $1`,
      [auth.userId]
    );
    const lastAt: Date | null = (rows[0] as { last_generation_at: Date | null } | undefined)?.last_generation_at ?? null;

    if (!lastAt) {
      res.json({ canGenerate: true, nextAllowedAt: null });
      return;
    }

    const elapsed = Date.now() - lastAt.getTime();
    if (elapsed >= FREE_GENERATION_WINDOW_MS) {
      res.json({ canGenerate: true, nextAllowedAt: null });
    } else {
      const nextAllowedAt = new Date(lastAt.getTime() + FREE_GENERATION_WINDOW_MS).toISOString();
      res.json({ canGenerate: false, nextAllowedAt });
    }
  } catch {
    res.status(500).json({ error: "Failed to fetch usage" });
  }
});

/**
 * POST /api/usage/scripter/start
 * Atomically checks the 23-hour rolling window and records a generation.
 * For free users: returns { allowed: false, nextAllowedAt } if within 23h of last generation.
 * For subscribers/pro/admin: always returns { allowed: true }.
 *
 * This is the authoritative enforcement point — the frontend must call this
 * before starting any auto-generation and respect the result.
 */
router.post("/usage/scripter/start", async (req: Request, res: Response) => {
  const auth = getAuth(req);
  if (!auth.userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  const plan = await getPlan(auth.userId);
  if (plan !== "free") {
    res.json({ allowed: true, nextAllowedAt: null });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows } = await client.query(
      `SELECT plan, last_generation_at FROM users WHERE clerk_id = $1 FOR UPDATE`,
      [auth.userId]
    );
    const row = rows[0] as { plan: string; last_generation_at: Date | null } | undefined;
    const lockedPlan = row?.plan ?? "free";

    if (lockedPlan !== "free") {
      await client.query("COMMIT");
      res.json({ allowed: true, nextAllowedAt: null });
      return;
    }

    const lastAt: Date | null = row?.last_generation_at ?? null;
    if (lastAt) {
      const elapsed = Date.now() - lastAt.getTime();
      if (elapsed < FREE_GENERATION_WINDOW_MS) {
        await client.query("COMMIT");
        const nextAllowedAt = new Date(lastAt.getTime() + FREE_GENERATION_WINDOW_MS).toISOString();
        res.json({ allowed: false, nextAllowedAt });
        return;
      }
    }

    await client.query(
      `UPDATE users SET last_generation_at = NOW() WHERE clerk_id = $1`,
      [auth.userId]
    );

    await client.query("COMMIT");
    const nextAllowedAt = new Date(Date.now() + FREE_GENERATION_WINDOW_MS).toISOString();
    res.json({ allowed: true, nextAllowedAt });
  } catch (err) {
    await client.query("ROLLBACK");
    logger.error({ err }, "Failed to record generation usage");
    res.status(500).json({ error: "Failed to record usage" });
  } finally {
    client.release();
  }
});

export default router;
