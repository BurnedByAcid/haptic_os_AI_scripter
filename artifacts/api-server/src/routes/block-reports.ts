import { Router, type Request, type Response } from "express";
import { logger } from "../lib/logger";
import { pool } from "../lib/db";

const router = Router();

const MAX_REASON_LEN = 2000;
const MAX_ITEM_LEN = 2000;
const MAX_KIND_LEN = 64;
const VALID_CATEGORIES = ["bug", "suggestion", "other"] as const;
type FeedbackCategory = typeof VALID_CATEGORIES[number];

router.post("/block-reports", async (req: Request, res: Response) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const kind = typeof body.kind === "string" ? body.kind.slice(0, MAX_KIND_LEN) : "unknown";
    const item = typeof body.item === "string" ? body.item.slice(0, MAX_ITEM_LEN) : "";
    const reason = typeof body.reason === "string" ? body.reason.slice(0, MAX_REASON_LEN) : "";
    const blockMessage =
      typeof body.blockMessage === "string" ? body.blockMessage.slice(0, MAX_ITEM_LEN) : "";
    const userEmail =
      typeof body.userEmail === "string" ? body.userEmail.slice(0, 320) : null;
    const userId =
      typeof body.userId === "string" ? body.userId.slice(0, 256) : null;
    const rawCategory = typeof body.category === "string" ? body.category : "other";
    const category: FeedbackCategory = VALID_CATEGORIES.includes(rawCategory as FeedbackCategory)
      ? (rawCategory as FeedbackCategory)
      : "other";

    if (!reason.trim()) {
      res.status(400).json({ error: "Validation failed", details: ["reason is required"] });
      return;
    }

    logger.warn(
      {
        type: "block_report",
        kind,
        item,
        blockMessage,
        reason,
        userEmail,
        ip: req.ip,
        ua: req.headers["user-agent"],
      },
      "User reported a blocked item"
    );

    // Persist user-submitted feedback to the database for admin review
    if (kind === "feedback") {
      await pool.query(
        `INSERT INTO feedback (user_id, user_email, category, message) VALUES ($1, $2, $3, $4)`,
        [userId, userEmail, category, reason.trim()]
      );
    }

    res.status(201).json({ ok: true });
  } catch (err) {
    logger.error({ err }, "Failed to record block report");
    res.status(500).json({ error: "Failed to record report" });
  }
});

export default router;
