import { Router, type Request, type Response } from "express";
import { getAuth } from "@clerk/express";
import { pool } from "../lib/db";
import { sanitizeText } from "../lib/validation";
import { validateFunscriptJson } from "@workspace/validation";
import { writeLimiter } from "../middlewares/rateLimiters";

const router = Router();

const NAME_MAX = 120;
const JSON_MAX_BYTES = 10 * 1024 * 1024;
const SUBSCRIBER_PLANS = new Set(["subscriber", "pro", "admin"]);

async function getPlan(userId: string): Promise<string> {
  const { rows } = await pool.query(
    `SELECT plan FROM users WHERE clerk_id = $1`,
    [userId],
  );
  return (rows[0] as { plan?: string } | undefined)?.plan ?? "free";
}

function parseId(raw: string): number | null {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) return null;
  return n;
}

function validateAndNormalizeName(rawName: unknown): { name: string } | { error: string } {
  const name = sanitizeText(rawName).slice(0, NAME_MAX);
  if (!name) return { error: "Session name is required." };
  return { name };
}

function validateAndNormalizeFunscript(rawJson: unknown): { jsonStr: string } | { error: string } {
  if (rawJson === undefined || rawJson === null) {
    return { error: "funscript_json is required." };
  }
  const jsonStr = typeof rawJson === "string" ? rawJson : JSON.stringify(rawJson);
  if (jsonStr.length > JSON_MAX_BYTES) {
    return { error: "funscript_json exceeds 10 MB." };
  }
  let parsed: unknown;
  try { parsed = JSON.parse(jsonStr); } catch {
    return { error: "funscript_json is not valid JSON." };
  }
  const fsErr = validateFunscriptJson(parsed);
  if (fsErr) return { error: fsErr.message };
  return { jsonStr };
}

/** GET /api/scripter-sessions — list user's sessions (metadata only, no funscript body). */
router.get("/scripter-sessions", async (req: Request, res: Response) => {
  const auth = getAuth(req);
  if (!auth.userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  try {
    const { rows } = await pool.query(
      `SELECT id, name, created_at, updated_at
       FROM scripter_sessions WHERE user_id = $1 ORDER BY updated_at DESC`,
      [auth.userId],
    );
    res.json(rows);
  } catch {
    res.status(500).json({ error: "Failed to fetch sessions" });
  }
});

/** GET /api/scripter-sessions/:id — fetch one session including funscript_json. */
router.get("/scripter-sessions/:id", async (req: Request, res: Response) => {
  const auth = getAuth(req);
  if (!auth.userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  const id = parseId(req.params.id);
  if (id === null) { res.status(400).json({ error: "Invalid session id" }); return; }
  try {
    const { rows } = await pool.query(
      `SELECT id, name, funscript_json, created_at, updated_at
       FROM scripter_sessions WHERE id = $1 AND user_id = $2`,
      [id, auth.userId],
    );
    if (!rows.length) { res.status(404).json({ error: "Session not found" }); return; }
    res.json(rows[0]);
  } catch {
    res.status(500).json({ error: "Failed to fetch session" });
  }
});

/**
 * POST /api/scripter-sessions — create a new named session.
 * Subscriber-tier required. Validates name (sanitized, unique per user) and
 * funscript body on every write.
 */
router.post("/scripter-sessions", writeLimiter, async (req: Request, res: Response) => {
  const auth = getAuth(req);
  if (!auth.userId) { res.status(401).json({ error: "Not authenticated" }); return; }

  try {
    const plan = await getPlan(auth.userId);
    if (!SUBSCRIBER_PLANS.has(plan)) {
      res.status(403).json({ error: "Saving sessions is a subscriber feature." });
      return;
    }

    const { name: rawName, funscript_json: rawJson } = req.body as Record<string, unknown>;

    const nameResult = validateAndNormalizeName(rawName);
    if ("error" in nameResult) { res.status(400).json({ error: nameResult.error }); return; }
    const { name } = nameResult;

    const fsResult = validateAndNormalizeFunscript(rawJson);
    if ("error" in fsResult) { res.status(400).json({ error: fsResult.error }); return; }
    const { jsonStr } = fsResult;

    const { rows } = await pool.query(
      `INSERT INTO scripter_sessions (user_id, name, funscript_json, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW())
       RETURNING id, name, created_at, updated_at`,
      [auth.userId, name, jsonStr],
    );
    res.status(201).json(rows[0]);
  } catch (err: unknown) {
    const dbErr = err as { constraint?: string };
    if (dbErr?.constraint === "scripter_sessions_user_id_name_unique") {
      res.status(409).json({ error: `A session named "${String((req.body as Record<string, unknown>).name ?? "").slice(0, 120)}" already exists. Please choose a different name.` });
      return;
    }
    res.status(500).json({ error: "Failed to create session" });
  }
});

/**
 * PUT /api/scripter-sessions/:id — overwrite a session's funscript (and optionally name).
 * Subscriber-tier required. Validates name and funscript on every write.
 */
router.put("/scripter-sessions/:id", writeLimiter, async (req: Request, res: Response) => {
  const auth = getAuth(req);
  if (!auth.userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  const id = parseId(req.params.id);
  if (id === null) { res.status(400).json({ error: "Invalid session id" }); return; }

  try {
    const plan = await getPlan(auth.userId);
    if (!SUBSCRIBER_PLANS.has(plan)) {
      res.status(403).json({ error: "Saving sessions is a subscriber feature." });
      return;
    }

    const { name: rawName, funscript_json: rawJson } = req.body as Record<string, unknown>;

    const nameResult = validateAndNormalizeName(rawName);
    if ("error" in nameResult) { res.status(400).json({ error: nameResult.error }); return; }
    const { name } = nameResult;

    const fsResult = validateAndNormalizeFunscript(rawJson);
    if ("error" in fsResult) { res.status(400).json({ error: fsResult.error }); return; }
    const { jsonStr } = fsResult;

    const { rows, rowCount } = await pool.query(
      `UPDATE scripter_sessions
       SET name = $1, funscript_json = $2, updated_at = NOW()
       WHERE id = $3 AND user_id = $4
       RETURNING id, name, created_at, updated_at`,
      [name, jsonStr, id, auth.userId],
    );
    if (!rowCount) { res.status(404).json({ error: "Session not found" }); return; }
    res.json(rows[0]);
  } catch (err: unknown) {
    const dbErr = err as { constraint?: string };
    if (dbErr?.constraint === "scripter_sessions_user_id_name_unique") {
      res.status(409).json({ error: `A session with that name already exists. Please choose a different name.` });
      return;
    }
    res.status(500).json({ error: "Failed to save session" });
  }
});

/**
 * PATCH /api/scripter-sessions/:id — rename a session (name only, no funscript change).
 * Subscriber-tier required.
 */
router.patch("/scripter-sessions/:id", writeLimiter, async (req: Request, res: Response) => {
  const auth = getAuth(req);
  if (!auth.userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  const id = parseId(req.params.id);
  if (id === null) { res.status(400).json({ error: "Invalid session id" }); return; }

  try {
    const plan = await getPlan(auth.userId);
    if (!SUBSCRIBER_PLANS.has(plan)) {
      res.status(403).json({ error: "Renaming sessions is a subscriber feature." });
      return;
    }

    const { name: rawName } = req.body as Record<string, unknown>;
    const nameResult = validateAndNormalizeName(rawName);
    if ("error" in nameResult) { res.status(400).json({ error: nameResult.error }); return; }
    const { name } = nameResult;

    const { rows, rowCount } = await pool.query(
      `UPDATE scripter_sessions SET name = $1, updated_at = NOW()
       WHERE id = $2 AND user_id = $3
       RETURNING id, name, created_at, updated_at`,
      [name, id, auth.userId],
    );
    if (!rowCount) { res.status(404).json({ error: "Session not found" }); return; }
    res.json(rows[0]);
  } catch (err: unknown) {
    const dbErr = err as { constraint?: string };
    if (dbErr?.constraint === "scripter_sessions_user_id_name_unique") {
      res.status(409).json({ error: `A session with that name already exists. Please choose a different name.` });
      return;
    }
    res.status(500).json({ error: "Failed to rename session" });
  }
});

/**
 * POST /api/scripter-sessions/:id/duplicate — duplicate a session.
 * Creates a copy with "Copy of <name>" (or "Copy of <name> (2)" etc. to stay unique).
 * Subscriber-tier required.
 */
router.post("/scripter-sessions/:id/duplicate", writeLimiter, async (req: Request, res: Response) => {
  const auth = getAuth(req);
  if (!auth.userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  const id = parseId(req.params.id);
  if (id === null) { res.status(400).json({ error: "Invalid session id" }); return; }

  try {
    const plan = await getPlan(auth.userId);
    if (!SUBSCRIBER_PLANS.has(plan)) {
      res.status(403).json({ error: "Duplicating sessions is a subscriber feature." });
      return;
    }

    const { rows: srcRows } = await pool.query(
      `SELECT name, funscript_json FROM scripter_sessions WHERE id = $1 AND user_id = $2`,
      [id, auth.userId],
    );
    if (!srcRows.length) { res.status(404).json({ error: "Session not found" }); return; }
    const src = srcRows[0] as { name: string; funscript_json: string };

    // Build a unique "Copy of X" name.
    // Reserve space for the " (N)" suffix so truncation never produces a
    // candidate that collides with a prior attempt (max suffix " (999)" = 6 chars).
    const SUFFIX_RESERVE = 6;
    const base = `Copy of ${src.name}`.slice(0, NAME_MAX - SUFFIX_RESERVE);
    const { rows: existingRows } = await pool.query(
      `SELECT name FROM scripter_sessions WHERE user_id = $1`,
      [auth.userId],
    );
    const existingNames = new Set((existingRows as { name: string }[]).map(r => r.name));
    let candidate = base;
    let counter = 2;
    const MAX_ATTEMPTS = 999;
    while (existingNames.has(candidate) && counter <= MAX_ATTEMPTS) {
      candidate = `${base} (${counter})`;
      counter++;
    }
    if (existingNames.has(candidate)) {
      res.status(409).json({ error: "Could not generate a unique name for the duplicate. Please rename the original first." });
      return;
    }

    const { rows } = await pool.query(
      `INSERT INTO scripter_sessions (user_id, name, funscript_json, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW())
       RETURNING id, name, created_at, updated_at`,
      [auth.userId, candidate, src.funscript_json],
    );
    res.status(201).json(rows[0]);
  } catch {
    res.status(500).json({ error: "Failed to duplicate session" });
  }
});

/**
 * DELETE /api/scripter-sessions/:id — remove a session.
 * Subscriber-tier required.
 */
router.delete("/scripter-sessions/:id", writeLimiter, async (req: Request, res: Response) => {
  const auth = getAuth(req);
  if (!auth.userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  const id = parseId(req.params.id);
  if (id === null) { res.status(400).json({ error: "Invalid session id" }); return; }

  try {
    const plan = await getPlan(auth.userId);
    if (!SUBSCRIBER_PLANS.has(plan)) {
      res.status(403).json({ error: "Deleting sessions is a subscriber feature." });
      return;
    }

    const { rowCount } = await pool.query(
      `DELETE FROM scripter_sessions WHERE id = $1 AND user_id = $2`,
      [id, auth.userId],
    );
    if (!rowCount) { res.status(404).json({ error: "Session not found" }); return; }
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "Failed to delete session" });
  }
});

export default router;
