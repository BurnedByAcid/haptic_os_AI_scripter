import { Router, type Request, type Response } from "express";
import { getAuth } from "@clerk/express";
import { pool } from "../lib/db";
import { sanitizeText, validateFunscriptJson } from "../lib/validation";
import { writeLimiter } from "../middlewares/rateLimiters";

const router = Router();

const NAME_MAX = 120;
const JSON_MAX_BYTES = 10 * 1024 * 1024;

const FREE_CAP = 1;
const SUBSCRIBER_CAP = 5;
const SUBSCRIBER_PLANS = new Set(["subscriber", "pro", "admin"]);

function capForPlan(plan: string): number {
  return SUBSCRIBER_PLANS.has(plan) ? SUBSCRIBER_CAP : FREE_CAP;
}

async function getPlan(userId: string): Promise<string> {
  const { rows } = await pool.query(
    `SELECT plan FROM users WHERE clerk_id = $1`,
    [userId],
  );
  return (rows[0] as { plan?: string } | undefined)?.plan ?? "free";
}

function parseId(raw: string): number | null {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

/**
 * Confirm the calling user owns this library entry. Returns the row or null.
 */
async function ownLibraryEntry(
  userId: string,
  libraryId: number,
): Promise<{ id: number; funscript: string } | null> {
  const { rows } = await pool.query(
    `SELECT id, funscript FROM private_library WHERE id = $1 AND user_id = $2`,
    [libraryId, userId],
  );
  if (!rows.length) return null;
  return rows[0] as { id: number; funscript: string };
}

/**
 * Lazy one-time migration: if this library entry has no rows in
 * private_library_funscripts yet, seed one from the legacy `funscript`
 * column (named "Default", marked active). Idempotent — subsequent calls
 * are no-ops because the unique (library_id, name) constraint prevents
 * duplicates and we only seed when count = 0.
 */
async function seedLegacyIfEmpty(
  userId: string,
  libraryId: number,
  legacyFunscript: string,
): Promise<void> {
  const { rows } = await pool.query(
    `SELECT 1 FROM private_library_funscripts WHERE library_id = $1 LIMIT 1`,
    [libraryId],
  );
  if (rows.length) return;
  await pool.query(
    `INSERT INTO private_library_funscripts
       (library_id, user_id, name, funscript_json, is_active, created_at, updated_at)
     VALUES ($1, $2, $3, $4, TRUE, NOW(), NOW())
     ON CONFLICT (library_id, name) DO NOTHING`,
    [libraryId, userId, "Default", legacyFunscript],
  );
}

/** GET /api/library/:libraryId/funscripts — list scripts attached to one media. */
router.get("/library/:libraryId/funscripts", async (req: Request, res: Response) => {
  const auth = getAuth(req);
  if (!auth.userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  const libraryId = parseId(req.params.libraryId);
  if (libraryId === null) { res.status(400).json({ error: "Invalid library id" }); return; }
  try {
    const owned = await ownLibraryEntry(auth.userId, libraryId);
    if (!owned) { res.status(404).json({ error: "Not found" }); return; }
    await seedLegacyIfEmpty(auth.userId, libraryId, owned.funscript);

    const { rows } = await pool.query(
      `SELECT id, name, is_active, created_at, updated_at
       FROM private_library_funscripts
       WHERE library_id = $1
       ORDER BY is_active DESC, created_at ASC`,
      [libraryId],
    );
    const plan = await getPlan(auth.userId);
    res.json({
      cap: capForPlan(plan),
      plan,
      funscripts: rows,
    });
  } catch {
    res.status(500).json({ error: "Failed to fetch funscripts" });
  }
});

/** GET /api/library/:libraryId/funscripts/:id — fetch one full body. */
router.get("/library/:libraryId/funscripts/:id", async (req: Request, res: Response) => {
  const auth = getAuth(req);
  if (!auth.userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  const libraryId = parseId(req.params.libraryId);
  const id = parseId(req.params.id);
  if (libraryId === null || id === null) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const { rows } = await pool.query(
      `SELECT id, name, funscript_json, is_active, created_at, updated_at
       FROM private_library_funscripts
       WHERE id = $1 AND library_id = $2 AND user_id = $3`,
      [id, libraryId, auth.userId],
    );
    if (!rows.length) { res.status(404).json({ error: "Not found" }); return; }
    res.json(rows[0]);
  } catch {
    res.status(500).json({ error: "Failed to fetch funscript" });
  }
});

/**
 * POST /api/library/:libraryId/funscripts — add a new attached script.
 * Server enforces per-plan cap. Validates name + funscript_json on every write.
 */
router.post("/library/:libraryId/funscripts", writeLimiter, async (req: Request, res: Response) => {
  const auth = getAuth(req);
  if (!auth.userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  const libraryId = parseId(req.params.libraryId);
  if (libraryId === null) { res.status(400).json({ error: "Invalid library id" }); return; }

  try {
    const { name: rawName, funscript_json: rawJson, set_active: rawSetActive } = req.body as Record<string, unknown>;

    const name = sanitizeText(rawName).slice(0, NAME_MAX);
    if (!name) { res.status(400).json({ error: "Script name is required." }); return; }

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
    const fsErr = validateFunscriptJson(parsed);
    if (fsErr) { res.status(400).json({ error: fsErr }); return; }

    const setActive = rawSetActive === true;
    const plan = await getPlan(auth.userId);
    const cap = capForPlan(plan);

    // Atomic cap enforcement: lock the parent media row FOR UPDATE so two
    // concurrent requests serialize their count+insert. Without this, two
    // simultaneous adds could both pass the count check and exceed the cap.
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const { rows: ownRows } = await client.query(
        `SELECT id, funscript FROM private_library
         WHERE id = $1 AND user_id = $2 FOR UPDATE`,
        [libraryId, auth.userId],
      );
      if (!ownRows.length) {
        await client.query("ROLLBACK");
        res.status(404).json({ error: "Not found" }); return;
      }
      const legacy = (ownRows[0] as { funscript: string }).funscript;

      // Lazy seed inside the same transaction so the cap check sees seeded rows.
      await client.query(
        `INSERT INTO private_library_funscripts
           (library_id, user_id, name, funscript_json, is_active, created_at, updated_at)
         SELECT $1, $2, 'Default', $3, TRUE, NOW(), NOW()
         WHERE NOT EXISTS (
           SELECT 1 FROM private_library_funscripts WHERE library_id = $1
         )
         ON CONFLICT (library_id, name) DO NOTHING`,
        [libraryId, auth.userId, legacy],
      );

      const { rows: countRows } = await client.query(
        `SELECT COUNT(*)::int AS n FROM private_library_funscripts WHERE library_id = $1`,
        [libraryId],
      );
      const currentCount = (countRows[0] as { n: number }).n;
      if (currentCount >= cap) {
        await client.query("ROLLBACK");
        const message = SUBSCRIBER_PLANS.has(plan)
          ? `Subscribers can attach up to ${SUBSCRIBER_CAP} funscripts per media.`
          : `Free tier supports ${FREE_CAP} funscript per media. Upgrade to Subscriber for up to ${SUBSCRIBER_CAP}.`;
        res.status(403).json({ error: message, code: "CAP_REACHED", cap, plan });
        return;
      }

      if (setActive) {
        await client.query(
          `UPDATE private_library_funscripts SET is_active = FALSE WHERE library_id = $1`,
          [libraryId],
        );
      }
      const { rows } = await client.query(
        `INSERT INTO private_library_funscripts
           (library_id, user_id, name, funscript_json, is_active, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
         RETURNING id, name, is_active, created_at, updated_at`,
        [libraryId, auth.userId, name, jsonStr, setActive],
      );
      await client.query("COMMIT");
      res.status(201).json(rows[0]);
    } catch (err) {
      await client.query("ROLLBACK");
      const code = (err as { code?: string }).code;
      if (code === "23505") {
        res.status(409).json({ error: `A script named "${name}" already exists for this media.` });
        return;
      }
      throw err;
    } finally {
      client.release();
    }
  } catch {
    res.status(500).json({ error: "Failed to add funscript" });
  }
});

/**
 * PUT /api/library/:libraryId/funscripts/:id — rename, replace body, or set active.
 * Any combination of `name`, `funscript_json`, `set_active` may be sent.
 * Re-validates everything provided. Setting active clears other actives in the same media.
 */
router.put("/library/:libraryId/funscripts/:id", writeLimiter, async (req: Request, res: Response) => {
  const auth = getAuth(req);
  if (!auth.userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  const libraryId = parseId(req.params.libraryId);
  const id = parseId(req.params.id);
  if (libraryId === null || id === null) { res.status(400).json({ error: "Invalid id" }); return; }

  try {
    const { rows: ownRows } = await pool.query(
      `SELECT id FROM private_library_funscripts
       WHERE id = $1 AND library_id = $2 AND user_id = $3`,
      [id, libraryId, auth.userId],
    );
    if (!ownRows.length) { res.status(404).json({ error: "Not found" }); return; }

    const body = req.body as Record<string, unknown>;
    const setActive = body.set_active === true;

    let nextName: string | null = null;
    if (body.name !== undefined) {
      nextName = sanitizeText(body.name).slice(0, NAME_MAX);
      if (!nextName) { res.status(400).json({ error: "Script name cannot be empty." }); return; }
    }

    let nextJson: string | null = null;
    if (body.funscript_json !== undefined && body.funscript_json !== null) {
      const jsonStr = typeof body.funscript_json === "string"
        ? body.funscript_json
        : JSON.stringify(body.funscript_json);
      if (jsonStr.length > JSON_MAX_BYTES) {
        res.status(400).json({ error: "funscript_json exceeds 10 MB." }); return;
      }
      let parsed: unknown;
      try { parsed = JSON.parse(jsonStr); } catch {
        res.status(400).json({ error: "funscript_json is not valid JSON." }); return;
      }
      const fsErr = validateFunscriptJson(parsed);
      if (fsErr) { res.status(400).json({ error: fsErr }); return; }
      nextJson = jsonStr;
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      if (setActive) {
        await client.query(
          `UPDATE private_library_funscripts SET is_active = FALSE WHERE library_id = $1`,
          [libraryId],
        );
      }

      const sets: string[] = ["updated_at = NOW()"];
      const params: unknown[] = [];
      if (nextName !== null) {
        params.push(nextName);
        sets.push(`name = $${params.length}`);
      }
      if (nextJson !== null) {
        params.push(nextJson);
        sets.push(`funscript_json = $${params.length}`);
      }
      if (setActive) {
        sets.push(`is_active = TRUE`);
      }

      params.push(id);
      params.push(libraryId);
      params.push(auth.userId);
      const sql = `
        UPDATE private_library_funscripts
        SET ${sets.join(", ")}
        WHERE id = $${params.length - 2}
          AND library_id = $${params.length - 1}
          AND user_id = $${params.length}
        RETURNING id, name, is_active, created_at, updated_at
      `;
      const { rows } = await client.query(sql, params);
      await client.query("COMMIT");
      res.json(rows[0]);
    } catch (err) {
      await client.query("ROLLBACK");
      const code = (err as { code?: string }).code;
      if (code === "23505") {
        res.status(409).json({ error: "Another script with that name already exists for this media." });
        return;
      }
      throw err;
    } finally {
      client.release();
    }
  } catch {
    res.status(500).json({ error: "Failed to update funscript" });
  }
});

/**
 * DELETE /api/library/:libraryId/funscripts/:id — remove one attached script.
 *
 * If the deleted script was the active one, automatically promote the
 * oldest remaining script to active so the parent media is never left
 * with attached scripts but no active selection (the player launcher
 * relies on `is_active = TRUE` to pick a script).
 */
router.delete("/library/:libraryId/funscripts/:id", writeLimiter, async (req: Request, res: Response) => {
  const auth = getAuth(req);
  if (!auth.userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  const libraryId = parseId(req.params.libraryId);
  const id = parseId(req.params.id);
  if (libraryId === null || id === null) { res.status(400).json({ error: "Invalid id" }); return; }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Lock the parent media row to serialize concurrent deletes/promotions.
    const { rows: ownRows } = await client.query(
      `SELECT id FROM private_library WHERE id = $1 AND user_id = $2 FOR UPDATE`,
      [libraryId, auth.userId],
    );
    if (!ownRows.length) {
      await client.query("ROLLBACK");
      res.status(404).json({ error: "Not found" }); return;
    }
    // Refuse to delete the last script for this media — every entry must
    // always have at least one funscript so the player launcher and the
    // legacy /library/:id/funscript endpoint always have something to serve.
    // (The lazy-seed path would otherwise resurrect a "Default" from the
    // legacy column, making delete non-durable for the final script.)
    const { rows: countRows } = await client.query(
      `SELECT COUNT(*)::int AS n FROM private_library_funscripts WHERE library_id = $1`,
      [libraryId],
    );
    if (((countRows[0] as { n: number }).n) <= 1) {
      await client.query("ROLLBACK");
      res.status(409).json({
        error: "Can't delete the only script. Add another script first or delete the entire library entry.",
      });
      return;
    }

    const { rows: deleted } = await client.query(
      `DELETE FROM private_library_funscripts
       WHERE id = $1 AND library_id = $2 AND user_id = $3
       RETURNING is_active`,
      [id, libraryId, auth.userId],
    );
    if (!deleted.length) {
      await client.query("ROLLBACK");
      res.status(404).json({ error: "Not found" }); return;
    }
    const wasActive = (deleted[0] as { is_active: boolean }).is_active;
    if (wasActive) {
      // Promote the oldest remaining script to active, if any remain.
      await client.query(
        `UPDATE private_library_funscripts
         SET is_active = TRUE, updated_at = NOW()
         WHERE id = (
           SELECT id FROM private_library_funscripts
           WHERE library_id = $1
           ORDER BY created_at ASC
           LIMIT 1
         )`,
        [libraryId],
      );
    }
    await client.query("COMMIT");
    res.json({ ok: true });
  } catch {
    await client.query("ROLLBACK").catch(() => undefined);
    res.status(500).json({ error: "Failed to delete funscript" });
  } finally {
    client.release();
  }
});

export default router;
