import { Router, type Request, type Response } from "express";
import { logger } from "../lib/logger";

const router = Router();

const MAX_REASON_LEN = 2000;
const MAX_ITEM_LEN = 2000;
const MAX_KIND_LEN = 64;

router.post("/block-reports", (req: Request, res: Response) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const kind = typeof body.kind === "string" ? body.kind.slice(0, MAX_KIND_LEN) : "unknown";
    const item = typeof body.item === "string" ? body.item.slice(0, MAX_ITEM_LEN) : "";
    const reason = typeof body.reason === "string" ? body.reason.slice(0, MAX_REASON_LEN) : "";
    const blockMessage =
      typeof body.blockMessage === "string" ? body.blockMessage.slice(0, MAX_ITEM_LEN) : "";
    const userEmail =
      typeof body.userEmail === "string" ? body.userEmail.slice(0, 320) : null;

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

    res.status(201).json({ ok: true });
  } catch (err) {
    logger.error({ err }, "Failed to record block report");
    res.status(500).json({ error: "Failed to record report" });
  }
});

export default router;
