import { Router, type Request, type Response } from "express";
import { pool } from "../lib/db";
import {
  FIELD_LIMITS,
  sanitizeText,
  validateUrl,
  validateFunscriptJson,
} from "../lib/validation";
import { scriptUploadLimiter, writeLimiter } from "../middlewares/rateLimiters";

const router = Router();

// ─── Routes ───────────────────────────────────────────────────────────────

router.get("/scripts", async (_req: Request, res: Response) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, title, description, video_url, author_name, tags, downloads, created_at
       FROM shared_scripts ORDER BY created_at DESC LIMIT 100`
    );
    res.json(rows);
  } catch {
    res.status(500).json({ error: "Failed to fetch scripts" });
  }
});

router.get("/scripts/:id", async (req: Request, res: Response) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM shared_scripts WHERE id = $1`,
      [req.params.id]
    );
    if (!rows.length) { res.status(404).json({ error: "Not found" }); return; }
    await pool.query(`UPDATE shared_scripts SET downloads = downloads + 1 WHERE id = $1`, [req.params.id]);
    res.json(rows[0]);
  } catch {
    res.status(500).json({ error: "Failed to fetch script" });
  }
});

router.post("/scripts", writeLimiter, scriptUploadLimiter, async (req: Request, res: Response) => {
  // Payload size guard (10 MB — express.json() limit set in app.ts)
  try {
    const {
      title: rawTitle,
      description: rawDescription,
      video_url: rawVideoUrl,
      script_json: rawScriptJson,
      author_id: rawAuthorId,
      author_name: rawAuthorName,
      tags: rawTags,
    } = req.body as Record<string, unknown>;

    // Required field presence
    if (!rawTitle || !rawVideoUrl || !rawScriptJson) {
      const missing: string[] = [];
      if (!rawTitle) missing.push("title is required.");
      if (!rawVideoUrl) missing.push("video_url is required.");
      if (!rawScriptJson) missing.push("script_json is required.");
      res.status(400).json({ error: "Validation failed", details: missing });
      return;
    }

    // Sanitize text fields
    const title = sanitizeText(rawTitle);
    const description = sanitizeText(rawDescription ?? "");
    const author_name = sanitizeText(rawAuthorName ?? "") || "Anonymous";
    const tags = sanitizeText(rawTags ?? "");
    const author_id = typeof rawAuthorId === "string" ? rawAuthorId.slice(0, 128) : null;
    const video_url = typeof rawVideoUrl === "string" ? rawVideoUrl.trim() : "";
    const script_json_str = typeof rawScriptJson === "string" ? rawScriptJson : JSON.stringify(rawScriptJson);

    // Length limits
    const errors: string[] = [];
    if (!title) errors.push("title is required after sanitization.");
    if (title.length > FIELD_LIMITS.title) errors.push(`title must be ≤ ${FIELD_LIMITS.title} chars.`);
    if (description.length > FIELD_LIMITS.description) errors.push(`description must be ≤ ${FIELD_LIMITS.description} chars.`);
    if (author_name.length > FIELD_LIMITS.author_name) errors.push(`author_name must be ≤ ${FIELD_LIMITS.author_name} chars.`);
    if (tags.length > FIELD_LIMITS.tags) errors.push(`tags must be ≤ ${FIELD_LIMITS.tags} chars.`);

    // URL validation
    const urlErr = validateUrl(video_url);
    if (urlErr) errors.push(urlErr);

    // script_json size (backend 10 MB limit on JSON string itself)
    if (script_json_str.length > 10 * 1024 * 1024) errors.push("script_json exceeds 10 MB.");

    // Parse + validate funscript JSON
    let parsedScript: unknown;
    try { parsedScript = JSON.parse(script_json_str); } catch {
      errors.push("script_json is not valid JSON.");
    }
    if (parsedScript !== undefined) {
      const fsErr = validateFunscriptJson(parsedScript);
      if (fsErr) errors.push(fsErr);
    }

    if (errors.length > 0) {
      res.status(400).json({ error: "Validation failed", details: errors });
      return;
    }

    const { rows } = await pool.query(
      `INSERT INTO shared_scripts (title, description, video_url, script_json, author_id, author_name, tags)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, title, description, video_url, author_name, tags, downloads, created_at`,
      [title, description, video_url, script_json_str, author_id, author_name, tags]
    );
    res.status(201).json(rows[0]);
  } catch {
    res.status(500).json({ error: "Failed to save script" });
  }
});

router.delete("/scripts/:id", writeLimiter, async (req: Request, res: Response) => {
  try {
    const { author_id } = req.body as { author_id?: string };
    if (!author_id) { res.status(401).json({ error: "Unauthorized" }); return; }
    const { rowCount } = await pool.query(
      `DELETE FROM shared_scripts WHERE id = $1 AND author_id = $2`,
      [req.params.id, author_id]
    );
    if (!rowCount) { res.status(404).json({ error: "Not found or not your script" }); return; }
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "Failed to delete script" });
  }
});

export default router;
