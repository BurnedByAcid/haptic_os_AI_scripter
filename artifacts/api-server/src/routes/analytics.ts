import { Router, type Request, type Response } from "express";
import { getAuth } from "@clerk/express";
import { pool } from "../lib/db";

const router = Router();

const VALID_FEATURES = [
  "scripter", "games", "beat", "player",
  "community", "library", "control",
] as const;

/**
 * POST /api/analytics/event
 * Records a feature usage event. Fire-and-forget from the client.
 * Requires auth (so we can tie the event to the user's plan).
 */
router.post("/analytics/event", async (req: Request, res: Response) => {
  const auth = getAuth(req);
  if (!auth.userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  const { feature } = req.body as { feature?: unknown };

  if (typeof feature !== "string" || !VALID_FEATURES.includes(feature as typeof VALID_FEATURES[number])) {
    res.status(400).json({ error: `Invalid feature. Must be one of: ${VALID_FEATURES.join(", ")}` });
    return;
  }

  try {
    await pool.query(
      `INSERT INTO analytics_events (user_id, feature) VALUES ($1, $2)`,
      [auth.userId, feature]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error("analytics event error:", err);
    res.status(500).json({ error: "Failed to record event" });
  }
});

export default router;
