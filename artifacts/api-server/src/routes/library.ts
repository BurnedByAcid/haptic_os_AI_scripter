import { Router, type Request, type Response } from "express";
import { getAuth } from "@clerk/express";
import { pool } from "../lib/db";
import { getPlan } from "../lib/getPlan";
import sanitizeHtml from "sanitize-html";
import { validateTagsForWrite, parseTagsFilter, validateVideoUrl, sanitizeName } from "@workspace/validation";

const FREE_LIBRARY_LIMIT = 10;

const router = Router();

function sanitizeText(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return sanitizeHtml(raw, { allowedTags: [], allowedAttributes: {} })
    .replace(/[\x00-\x1F\x7F]/g, " ")
    .trim();
}

function validateFunscriptJson(raw: unknown): string | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return "funscript must be a JSON object.";
  }
  const obj = raw as Record<string, unknown>;
  if (!Array.isArray(obj.actions)) return 'funscript must have an "actions" array.';
  for (let i = 0; i < Math.min(obj.actions.length, 10); i++) {
    const a = obj.actions[i] as Record<string, unknown>;
    if (
      typeof a !== "object" || a === null ||
      typeof a.at !== "number" || typeof a.pos !== "number" ||
      a.at < 0 || a.pos < 0 || a.pos > 100
    ) {
      return `actions[${i}]: each action must have numeric "at" (≥0) and "pos" (0–100).`;
    }
  }
  return null;
}

/** GET /api/library — list the calling user's private library entries.
 *  Optional `?tags=foo,bar,baz` (max 3, AND/intersection) narrows the result.
 */
router.get("/library", async (req: Request, res: Response) => {
  const auth = getAuth(req);
  if (!auth.userId) { res.status(401).json({ error: "Not authenticated" }); return; }

  // Parse + sanitise tag filter — unknown tags are silently dropped so a
  // stale URL doesn't 400. Capped at MAX_TAG_FILTERS (3) to bound query cost.
  const tagFilter = parseTagsFilter(req.query.tags);

  try {
    // Include a count of scripts attached to each entry so the My Library
    // cards can show a "N / cap" badge without N+1 round-trips. Older entries
    // that haven't been touched since the multi-script feature shipped have
    // 0 rows in private_library_funscripts but always have the legacy single
    // funscript column populated, so they effectively have 1 script — surface
    // that as a minimum of 1 when the legacy column is non-null.
    const params: unknown[] = [auth.userId];
    let tagClause = "";
    if (tagFilter.length > 0) {
      params.push(tagFilter);
      tagClause = ` AND pl.tags @> $${params.length}::text[]`;
    }
    const { rows } = await pool.query(
      `SELECT pl.id, pl.title, pl.video_url, pl.local_file_path, pl.tags, pl.created_at,
              GREATEST(
                COALESCE((
                  SELECT COUNT(*)::int FROM private_library_funscripts plf
                  WHERE plf.library_id = pl.id AND plf.user_id = pl.user_id
                ), 0),
                CASE WHEN pl.funscript IS NOT NULL THEN 1 ELSE 0 END
              ) AS script_count
       FROM private_library pl
       WHERE pl.user_id = $1${tagClause}
       ORDER BY pl.created_at DESC`,
      params,
    );
    res.json(rows);
  } catch {
    res.status(500).json({ error: "Failed to fetch library" });
  }
});

/** POST /api/library — save a new entry to the private library */
router.post("/library", async (req: Request, res: Response) => {
  const auth = getAuth(req);
  if (!auth.userId) { res.status(401).json({ error: "Not authenticated" }); return; }

  // Enforce free plan library cap
  const plan = await getPlan(auth.userId);
  if (plan === "free") {
    const { rows: countRows } = await pool.query(
      `SELECT COUNT(*)::int AS count FROM private_library WHERE user_id = $1`,
      [auth.userId]
    );
    const currentCount = (countRows[0] as { count: number }).count;
    if (currentCount >= FREE_LIBRARY_LIMIT) {
      res.status(403).json({
        error: `Free accounts are limited to ${FREE_LIBRARY_LIMIT} library entries. Upgrade to add more.`,
        code: "LIBRARY_LIMIT_REACHED",
        limit: FREE_LIBRARY_LIMIT,
        count: currentCount,
      });
      return;
    }
  }

  const { title: rawTitle, video_url, local_file_path, funscript: rawFunscript, tags: rawTags } = req.body as Record<string, unknown>;

  const title = sanitizeText(rawTitle);
  if (!title) { res.status(400).json({ error: "title is required" }); return; }
  if (!rawFunscript) { res.status(400).json({ error: "funscript is required" }); return; }

  const tagsResult = validateTagsForWrite(rawTags);
  if ("error" in tagsResult) { res.status(400).json({ error: tagsResult.error.message }); return; }
  const tags = tagsResult.tags;

  const funscriptStr = typeof rawFunscript === "string" ? rawFunscript : JSON.stringify(rawFunscript);
  if (funscriptStr.length > 10 * 1024 * 1024) {
    res.status(400).json({ error: "funscript exceeds 10 MB" }); return;
  }

  let parsed: unknown;
  try { parsed = JSON.parse(funscriptStr); } catch {
    res.status(400).json({ error: "funscript is not valid JSON" }); return;
  }
  const fsErr = validateFunscriptJson(parsed);
  if (fsErr) { res.status(400).json({ error: fsErr }); return; }

  const videoUrl = typeof video_url === "string" ? video_url.trim() || null : null;
  const localFilePath = typeof local_file_path === "string" ? local_file_path.trim() || null : null;

  try {
    // Insert the media row + seed a row in private_library_funscripts named
    // "Default" marked active. The legacy `funscript` column is kept for
    // backwards compatibility / lazy seed of older entries.
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const { rows } = await client.query(
        `INSERT INTO private_library (user_id, title, video_url, local_file_path, funscript, tags)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, title, video_url, local_file_path, tags, created_at`,
        [auth.userId, title, videoUrl, localFilePath, funscriptStr, tags],
      );
      const libraryId = (rows[0] as { id: number }).id;
      await client.query(
        `INSERT INTO private_library_funscripts
           (library_id, user_id, name, funscript_json, is_active, created_at, updated_at)
         VALUES ($1, $2, 'Default', $3, TRUE, NOW(), NOW())
         ON CONFLICT (library_id, name) DO NOTHING`,
        [libraryId, auth.userId, funscriptStr]
      );
      await client.query("COMMIT");
      res.status(201).json(rows[0]);
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  } catch {
    res.status(500).json({ error: "Failed to save to library" });
  }
});

/**
 * GET /api/library/:id/funscript — download the *active* funscript for one entry.
 *
 * Backwards-compatible wrapper used by the player launcher and download buttons.
 * Prefers the active row from `private_library_funscripts`; falls back to the
 * legacy single-funscript column for entries that haven't been touched since
 * the multi-script feature shipped (lazy migration also covers this elsewhere).
 */
router.get("/library/:id/funscript", async (req: Request, res: Response) => {
  const auth = getAuth(req);
  if (!auth.userId) { res.status(401).json({ error: "Not authenticated" }); return; }

  try {
    const { rows: media } = await pool.query(
      `SELECT title, funscript FROM private_library WHERE id = $1 AND user_id = $2`,
      [req.params.id, auth.userId]
    );
    if (!media.length) { res.status(404).json({ error: "Not found" }); return; }
    const row = media[0] as { title: string; funscript: string };

    // Prefer the active script from the multi-script table. If no row is
    // marked active but rows exist (defensive — delete normally promotes a
    // new active), fall back to the OLDEST attached script — never to the
    // legacy column, which can be stale relative to the new table. Only
    // fall back to the legacy column when the new table is truly empty
    // (i.e. an old entry that hasn't been touched since this feature shipped).
    const { rows: fromTable } = await pool.query(
      `SELECT funscript_json, is_active
       FROM private_library_funscripts
       WHERE library_id = $1 AND user_id = $2
       ORDER BY is_active DESC, created_at ASC
       LIMIT 1`,
      [req.params.id, auth.userId],
    );
    const funscript = fromTable.length
      ? (fromTable[0] as { funscript_json: string }).funscript_json
      : row.funscript;

    res.json({ title: row.title, funscript });
  } catch {
    res.status(500).json({ error: "Failed to fetch funscript" });
  }
});

/** PATCH /api/library/:id/tags — update the tags on one library entry. */
router.patch("/library/:id/tags", async (req: Request, res: Response) => {
  const auth = getAuth(req);
  if (!auth.userId) { res.status(401).json({ error: "Not authenticated" }); return; }

  const tagsResult = validateTagsForWrite((req.body as Record<string, unknown>).tags);
  if ("error" in tagsResult) { res.status(400).json({ error: tagsResult.error.message }); return; }

  try {
    const { rowCount } = await pool.query(
      `UPDATE private_library SET tags = $1 WHERE id = $2 AND user_id = $3`,
      [tagsResult.tags, req.params.id, auth.userId],
    );
    if (!rowCount) { res.status(404).json({ error: "Not found or not your entry" }); return; }
    res.json({ ok: true, tags: tagsResult.tags });
  } catch {
    res.status(500).json({ error: "Failed to update tags" });
  }
});

/** PUT /api/library/:id — update title and/or video_url for one of the calling user's library entries */
router.put("/library/:id", async (req: Request, res: Response) => {
  const auth = getAuth(req);
  if (!auth.userId) { res.status(401).json({ error: "Not authenticated" }); return; }

  const { title: rawTitle, video_url } = req.body as Record<string, unknown>;

  // At least one field must be provided.
  if (rawTitle === undefined && video_url === undefined) {
    res.status(400).json({ error: "At least one of title or video_url must be provided" });
    return;
  }

  const updates: Record<string, unknown> = {};

  if (rawTitle !== undefined) {
    if (typeof rawTitle !== "string") { res.status(400).json({ error: "title must be a string" }); return; }
    const title = sanitizeName(rawTitle);
    if (!title) { res.status(400).json({ error: "title must be non-empty" }); return; }
    updates.title = title;
  }

  if (video_url !== undefined) {
    if (video_url === null || video_url === "") {
      // Clearing the URL is allowed.
      updates.video_url = null;
    } else {
      if (typeof video_url !== "string") {
        res.status(400).json({ error: "video_url must be a string" }); return;
      }
      const trimmedUrl = video_url.trim();
      // Use the shared validator — re-checks the current allowlist at edit time.
      const urlErr = validateVideoUrl(trimmedUrl);
      if (urlErr) {
        res.status(400).json({ error: urlErr.message }); return;
      }
      updates.video_url = trimmedUrl;
    }
  }

  // Build the SET clause dynamically.
  const fields = Object.keys(updates);
  const setClauses = fields.map((f, i) => `${f} = $${i + 1}`).join(", ");
  const values = fields.map((f) => updates[f]);
  values.push(req.params.id, auth.userId);

  try {
    const { rows } = await pool.query(
      `UPDATE private_library SET ${setClauses}
       WHERE id = $${fields.length + 1} AND user_id = $${fields.length + 2}
       RETURNING id, title, video_url, local_file_path, created_at`,
      values,
    );
    if (!rows.length) { res.status(404).json({ error: "Not found or not your entry" }); return; }
    res.json(rows[0]);
  } catch {
    res.status(500).json({ error: "Failed to update entry" });
  }
});

/** DELETE /api/library/:id — delete one of the calling user's library entries */
router.delete("/library/:id", async (req: Request, res: Response) => {
  const auth = getAuth(req);
  if (!auth.userId) { res.status(401).json({ error: "Not authenticated" }); return; }

  try {
    const { rowCount } = await pool.query(
      `DELETE FROM private_library WHERE id = $1 AND user_id = $2`,
      [req.params.id, auth.userId]
    );
    if (!rowCount) { res.status(404).json({ error: "Not found or not your entry" }); return; }
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "Failed to delete entry" });
  }
});

export default router;
