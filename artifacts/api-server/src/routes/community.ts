import { Router, type Request, type Response } from "express";
import { getAuth } from "@clerk/express";
import { pool } from "../lib/db";
import sanitizeHtml from "sanitize-html";
import { scriptUploadLimiter, writeLimiter } from "../middlewares/rateLimiters";

const router = Router();

// ─── Helpers ────────────────────────────────────────────────────────────────

function sanitizeText(raw: unknown, maxLen = 2000): string {
  if (typeof raw !== "string") return "";
  return sanitizeHtml(raw, { allowedTags: [], allowedAttributes: {} })
    .replace(/[\x00-\x1F\x7F]/g, " ")
    .trim()
    .slice(0, maxLen);
}

const PRIVATE_IP_RE =
  /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.0\.0\.0|::1|fc00:|fd[0-9a-f]{2}:)/i;

function validateUrl(raw: string): string | null {
  let url: URL;
  try { url = new URL(raw.trim()); } catch { return "video_url is not a valid URL."; }
  if (url.protocol !== "https:") return "video_url must use HTTPS.";
  const host = url.hostname.toLowerCase();
  if (PRIVATE_IP_RE.test(host)) return "video_url points to a private address.";
  return null;
}

function validateFunscriptJson(raw: unknown): string | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return "funscript must be a JSON object.";
  const obj = raw as Record<string, unknown>;
  if (!Array.isArray(obj.actions)) return 'funscript must have an "actions" array.';
  for (let i = 0; i < Math.min(obj.actions.length, 10); i++) {
    const a = obj.actions[i] as Record<string, unknown>;
    if (
      typeof a !== "object" || a === null ||
      typeof a.at !== "number" || typeof a.pos !== "number" ||
      a.at < 0 || a.pos < 0 || a.pos > 100
    ) return `actions[${i}]: invalid.`;
  }
  return null;
}

async function getCallerPlan(userId: string): Promise<string> {
  const { rows } = await pool.query(`SELECT plan FROM users WHERE clerk_id = $1`, [userId]);
  return (rows[0] as { plan: string } | undefined)?.plan ?? "free";
}

// ─── Routes ─────────────────────────────────────────────────────────────────

/**
 * GET /api/community
 * List shared scripts (paginated, newest first).
 * Includes aggregate favorite count and average rating.
 * Requires auth; returns per-user favorite/rating state when signed in.
 */
router.get("/community", async (req: Request, res: Response) => {
  const auth = getAuth(req);
  if (!auth.userId) { res.status(401).json({ error: "Not authenticated" }); return; }

  const limit = Math.min(20, Math.max(1, parseInt(String(req.query.limit ?? "20"), 10)));
  const offset = Math.max(0, parseInt(String(req.query.offset ?? "0"), 10));

  try {
    const { rows } = await pool.query(
      `SELECT
         cs.id, cs.user_id, cs.username, cs.title, cs.description,
         cs.video_url, cs.view_count, cs.created_at,
         COUNT(DISTINCT cf.user_id)::int        AS favorite_count,
         ROUND(AVG(cr.rating)::numeric, 1)::float AS avg_rating,
         COUNT(DISTINCT cr.user_id)::int         AS rating_count,
         BOOL_OR(cf.user_id = $3)               AS user_favorited,
         MAX(CASE WHEN cr.user_id = $3 THEN cr.rating END) AS user_rating
       FROM community_scripts cs
       LEFT JOIN community_favorites cf ON cf.script_id = cs.id
       LEFT JOIN community_ratings   cr ON cr.script_id = cs.id
       GROUP BY cs.id
       ORDER BY cs.created_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset, auth.userId]
    );
    const { rows: countRows } = await pool.query(`SELECT COUNT(*)::int AS total FROM community_scripts`);
    res.json({ scripts: rows, total: (countRows[0] as { total: number }).total, limit, offset });
  } catch (err) {
    console.error("GET /community error:", err);
    res.status(500).json({ error: "Failed to fetch community scripts" });
  }
});

/**
 * GET /api/community/:id
 * Get detail for a single shared script. Increments view_count.
 * Returns funscript content + aggregate stats.
 */
router.get("/community/:id", async (req: Request, res: Response) => {
  const auth = getAuth(req);
  if (!auth.userId) { res.status(401).json({ error: "Not authenticated" }); return; }

  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  try {
    await pool.query(`UPDATE community_scripts SET view_count = view_count + 1 WHERE id = $1`, [id]);

    const { rows } = await pool.query(
      `SELECT
         cs.id, cs.user_id, cs.username, cs.title, cs.description,
         cs.video_url, cs.funscript, cs.view_count, cs.created_at,
         COUNT(DISTINCT cf.user_id)::int        AS favorite_count,
         ROUND(AVG(cr.rating)::numeric, 1)::float AS avg_rating,
         COUNT(DISTINCT cr.user_id)::int         AS rating_count,
         BOOL_OR(cf.user_id = $2)               AS user_favorited,
         MAX(CASE WHEN cr.user_id = $2 THEN cr.rating END) AS user_rating
       FROM community_scripts cs
       LEFT JOIN community_favorites cf ON cf.script_id = cs.id
       LEFT JOIN community_ratings   cr ON cr.script_id = cs.id
       WHERE cs.id = $1
       GROUP BY cs.id`,
      [id, auth.userId]
    );
    if (!rows.length) { res.status(404).json({ error: "Not found" }); return; }
    res.json(rows[0]);
  } catch {
    res.status(500).json({ error: "Failed to fetch script" });
  }
});

/**
 * POST /api/community
 * Share a script. Subscriber-only.
 */
router.post("/community", writeLimiter, scriptUploadLimiter, async (req: Request, res: Response) => {
  const auth = getAuth(req);
  if (!auth.userId) { res.status(401).json({ error: "Not authenticated" }); return; }

  const plan = await getCallerPlan(auth.userId);
  if (plan === "free") {
    res.status(403).json({ error: "Community sharing requires a Pro subscription." }); return;
  }

  const {
    title: rawTitle,
    description: rawDescription,
    video_url: rawVideoUrl,
    funscript: rawFunscript,
  } = req.body as Record<string, unknown>;

  const title = sanitizeText(rawTitle, 255);
  const description = sanitizeText(rawDescription, 2000);
  const video_url = typeof rawVideoUrl === "string" ? rawVideoUrl.trim() : "";

  if (!title) { res.status(400).json({ error: "title is required" }); return; }
  if (!video_url) { res.status(400).json({ error: "video_url is required" }); return; }
  if (!rawFunscript) { res.status(400).json({ error: "funscript is required" }); return; }

  // Derive username from trusted DB record — never trust client-supplied username
  const { rows: userRows } = await pool.query(
    `SELECT username FROM users WHERE clerk_id = $1`,
    [auth.userId]
  );
  const username = (userRows[0] as { username: string } | undefined)?.username;
  if (!username) { res.status(400).json({ error: "User profile not found. Complete onboarding first." }); return; }

  const urlErr = validateUrl(video_url);
  if (urlErr) { res.status(400).json({ error: urlErr }); return; }

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

  try {
    const { rows } = await pool.query(
      `INSERT INTO community_scripts (user_id, username, title, description, video_url, funscript)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, user_id, username, title, description, video_url, view_count, created_at`,
      [auth.userId, username, title, description, video_url, funscriptStr]
    );
    res.status(201).json(rows[0]);
  } catch {
    res.status(500).json({ error: "Failed to share script" });
  }
});

/**
 * DELETE /api/community/:id
 * Delete own shared entry. Subscriber who owns the entry.
 */
router.delete("/community/:id", writeLimiter, async (req: Request, res: Response) => {
  const auth = getAuth(req);
  if (!auth.userId) { res.status(401).json({ error: "Not authenticated" }); return; }

  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  try {
    const { rowCount } = await pool.query(
      `DELETE FROM community_scripts WHERE id = $1 AND user_id = $2`,
      [id, auth.userId]
    );
    if (!rowCount) { res.status(404).json({ error: "Not found or not your script" }); return; }
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "Failed to delete" });
  }
});

/**
 * POST /api/community/:id/favorite
 * Toggle favorite for the calling user.
 */
router.post("/community/:id/favorite", writeLimiter, async (req: Request, res: Response) => {
  const auth = getAuth(req);
  if (!auth.userId) { res.status(401).json({ error: "Not authenticated" }); return; }

  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  try {
    const { rows: existing } = await pool.query(
      `SELECT 1 FROM community_favorites WHERE user_id = $1 AND script_id = $2`,
      [auth.userId, id]
    );
    if (existing.length > 0) {
      await pool.query(`DELETE FROM community_favorites WHERE user_id = $1 AND script_id = $2`, [auth.userId, id]);
      res.json({ favorited: false });
    } else {
      await pool.query(
        `INSERT INTO community_favorites (user_id, script_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [auth.userId, id]
      );
      res.json({ favorited: true });
    }
  } catch {
    res.status(500).json({ error: "Failed to toggle favorite" });
  }
});

/**
 * POST /api/community/:id/rate
 * Upsert a 1–5 rating for the calling user.
 */
router.post("/community/:id/rate", writeLimiter, async (req: Request, res: Response) => {
  const auth = getAuth(req);
  if (!auth.userId) { res.status(401).json({ error: "Not authenticated" }); return; }

  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const rating = parseInt(String((req.body as Record<string, unknown>).rating ?? ""), 10);
  if (isNaN(rating) || rating < 1 || rating > 5) {
    res.status(400).json({ error: "rating must be an integer 1–5" }); return;
  }

  try {
    await pool.query(
      `INSERT INTO community_ratings (user_id, script_id, rating) VALUES ($1, $2, $3)
       ON CONFLICT (user_id, script_id) DO UPDATE SET rating = EXCLUDED.rating`,
      [auth.userId, id, rating]
    );
    const { rows } = await pool.query(
      `SELECT ROUND(AVG(rating)::numeric, 1)::float AS avg_rating, COUNT(*)::int AS rating_count
       FROM community_ratings WHERE script_id = $1`,
      [id]
    );
    res.json({ ok: true, user_rating: rating, ...(rows[0] as object) });
  } catch {
    res.status(500).json({ error: "Failed to save rating" });
  }
});

export default router;
