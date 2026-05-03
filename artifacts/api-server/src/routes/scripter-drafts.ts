import { Router, type Request, type Response } from "express";
import { getAuth } from "@clerk/express";
import { pool } from "../lib/db";
import { sanitizeText, validateFunscriptJson } from "../lib/validation";
import { writeLimiter } from "../middlewares/rateLimiters";

const router = Router();

const MAX_SLOTS = 3;
const TTL_DAYS = 10;
const NAME_MAX = 120;
const JSON_MAX_BYTES = 10 * 1024 * 1024;

const SUBSCRIBER_PLANS = new Set(["subscriber", "pro", "admin"]);

function parseSlot(raw: string): number | null {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > MAX_SLOTS) return null;
  return n;
}

async function getPlan(userId: string): Promise<string> {
  const { rows } = await pool.query(
    `SELECT plan FROM users WHERE clerk_id = $1`,
    [userId],
  );
  return (rows[0] as { plan?: string } | undefined)?.plan ?? "free";
}

async function pruneExpired(userId: string): Promise<void> {
  await pool.query(
    `DELETE FROM scripter_drafts WHERE user_id = $1 AND expires_at < NOW()`,
    [userId],
  );
}

/** GET /api/scripter-drafts — list user's drafts (subscriber + free both allowed; free is read-only). */
router.get("/scripter-drafts", async (req: Request, res: Response) => {
  const auth = getAuth(req);
  if (!auth.userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  try {
    await pruneExpired(auth.userId);
    const { rows } = await pool.query(
      `SELECT id, slot, name, updated_at, expires_at
       FROM scripter_drafts WHERE user_id = $1 ORDER BY slot ASC`,
      [auth.userId],
    );
    res.json(rows);
  } catch {
    res.status(500).json({ error: "Failed to fetch drafts" });
  }
});

/** GET /api/scripter-drafts/:slot — fetch one draft including funscript_json. */
router.get("/scripter-drafts/:slot", async (req: Request, res: Response) => {
  const auth = getAuth(req);
  if (!auth.userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  const slot = parseSlot(req.params.slot);
  if (slot === null) { res.status(400).json({ error: "Invalid slot (must be 1, 2, or 3)" }); return; }
  try {
    await pruneExpired(auth.userId);
    const { rows } = await pool.query(
      `SELECT id, slot, name, funscript_json, updated_at, expires_at
       FROM scripter_drafts WHERE user_id = $1 AND slot = $2`,
      [auth.userId, slot],
    );
    if (!rows.length) { res.status(404).json({ error: "Draft not found" }); return; }
    res.json(rows[0]);
  } catch {
    res.status(500).json({ error: "Failed to fetch draft" });
  }
});

/**
 * PUT /api/scripter-drafts/:slot — upsert a draft.
 * Subscriber-tier required (free users get 403). Drafts cap at 3 slots and
 * expire 10 days after the last write. Both `name` and `funscript_json` are
 * re-validated on every write — never trust previously-stored values.
 */
router.put("/scripter-drafts/:slot", writeLimiter, async (req: Request, res: Response) => {
  const auth = getAuth(req);
  if (!auth.userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  const slot = parseSlot(req.params.slot);
  if (slot === null) { res.status(400).json({ error: "Invalid slot (must be 1, 2, or 3)" }); return; }

  try {
    const plan = await getPlan(auth.userId);
    if (!SUBSCRIBER_PLANS.has(plan)) {
      res.status(403).json({ error: "Auto-saving drafts is a subscriber feature." });
      return;
    }

    const { name: rawName, funscript_json: rawJson } = req.body as Record<string, unknown>;

    // Re-sanitize name on every write
    const name = sanitizeText(rawName).slice(0, NAME_MAX);
    if (!name) { res.status(400).json({ error: "Draft name is required." }); return; }

    if (rawJson === undefined || rawJson === null) {
      res.status(400).json({ error: "funscript_json is required." }); return;
    }
    const jsonStr = typeof rawJson === "string" ? rawJson : JSON.stringify(rawJson);
    if (jsonStr.length > JSON_MAX_BYTES) {
      res.status(400).json({ error: "funscript_json exceeds 10 MB." }); return;
    }
    let parsed: unknown;
    try { parsed = JSON.parse(jsonStr); } catch {
      res.status(400).json({ error: "funscript_json is not valid JSON." }); return;
    }
    // Re-validate funscript shape on every write — even if it's "the same draft"
    const fsErr = validateFunscriptJson(parsed);
    if (fsErr) { res.status(400).json({ error: fsErr }); return; }

    await pruneExpired(auth.userId);

    // Enforce 3-slot cap server-side: if this slot doesn't exist yet, count
    // active drafts and block if the user already has 3 in different slots.
    const { rows: existing } = await pool.query(
      `SELECT slot FROM scripter_drafts WHERE user_id = $1`,
      [auth.userId],
    );
    const haveThisSlot = existing.some((r) => (r as { slot: number }).slot === slot);
    if (!haveThisSlot && existing.length >= MAX_SLOTS) {
      res.status(409).json({ error: `Draft cap reached (${MAX_SLOTS}). Delete an existing slot first.` });
      return;
    }

    const expiresAtIso = new Date(Date.now() + TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();

    const { rows } = await pool.query(
      `INSERT INTO scripter_drafts (user_id, slot, name, funscript_json, updated_at, expires_at)
       VALUES ($1, $2, $3, $4, NOW(), $5)
       ON CONFLICT (user_id, slot) DO UPDATE
         SET name = EXCLUDED.name,
             funscript_json = EXCLUDED.funscript_json,
             updated_at = NOW(),
             expires_at = EXCLUDED.expires_at
       RETURNING id, slot, name, updated_at, expires_at`,
      [auth.userId, slot, name, jsonStr, expiresAtIso],
    );
    res.status(200).json(rows[0]);
  } catch {
    res.status(500).json({ error: "Failed to save draft" });
  }
});

/**
 * DELETE /api/scripter-drafts/:slot — remove a draft.
 *
 * Subscriber-tier required. Drafts of downgraded (free) users remain
 * read-only until their server-side TTL expires; allowing free-tier deletes
 * would violate the "drafts stay frozen until expiry" plan-downgrade
 * contract.
 */
router.delete("/scripter-drafts/:slot", writeLimiter, async (req: Request, res: Response) => {
  const auth = getAuth(req);
  if (!auth.userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  const slot = parseSlot(req.params.slot);
  if (slot === null) { res.status(400).json({ error: "Invalid slot (must be 1, 2, or 3)" }); return; }
  try {
    const plan = await getPlan(auth.userId);
    if (!SUBSCRIBER_PLANS.has(plan)) {
      res.status(403).json({ error: "Drafts are read-only on the free plan; they expire automatically." });
      return;
    }
    const { rowCount } = await pool.query(
      `DELETE FROM scripter_drafts WHERE user_id = $1 AND slot = $2`,
      [auth.userId, slot],
    );
    if (!rowCount) { res.status(404).json({ error: "Draft not found" }); return; }
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "Failed to delete draft" });
  }
});

export default router;
