import { Router, type Request, type Response } from "express";
import { getAuth } from "@clerk/express";
import { pool } from "../lib/db";
import sanitizeHtml from "sanitize-html";

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

/** GET /api/library — list the calling user's private library entries */
router.get("/library", async (req: Request, res: Response) => {
  const auth = getAuth(req);
  if (!auth.userId) { res.status(401).json({ error: "Not authenticated" }); return; }

  try {
    const { rows } = await pool.query(
      `SELECT id, title, video_url, local_file_path, created_at FROM private_library
       WHERE user_id = $1 ORDER BY created_at DESC`,
      [auth.userId]
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

  const { title: rawTitle, video_url, local_file_path, funscript: rawFunscript } = req.body as Record<string, unknown>;

  const title = sanitizeText(rawTitle);
  if (!title) { res.status(400).json({ error: "title is required" }); return; }
  if (!rawFunscript) { res.status(400).json({ error: "funscript is required" }); return; }

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
    const { rows } = await pool.query(
      `INSERT INTO private_library (user_id, title, video_url, local_file_path, funscript)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, title, video_url, local_file_path, created_at`,
      [auth.userId, title, videoUrl, localFilePath, funscriptStr]
    );
    res.status(201).json(rows[0]);
  } catch {
    res.status(500).json({ error: "Failed to save to library" });
  }
});

/** GET /api/library/:id/funscript — download the funscript for one entry */
router.get("/library/:id/funscript", async (req: Request, res: Response) => {
  const auth = getAuth(req);
  if (!auth.userId) { res.status(401).json({ error: "Not authenticated" }); return; }

  try {
    const { rows } = await pool.query(
      `SELECT title, funscript FROM private_library WHERE id = $1 AND user_id = $2`,
      [req.params.id, auth.userId]
    );
    if (!rows.length) { res.status(404).json({ error: "Not found" }); return; }
    const row = rows[0] as { title: string; funscript: string };
    res.json({ title: row.title, funscript: row.funscript });
  } catch {
    res.status(500).json({ error: "Failed to fetch funscript" });
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
