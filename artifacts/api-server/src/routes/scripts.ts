import { Router, type Request, type Response } from "express";
import sanitizeHtml from "sanitize-html";
import { pool } from "../lib/db";

const router = Router();

// ─── Validation helpers ────────────────────────────────────────────────────

const FIELD_LIMITS = {
  title: 255,
  description: 2000,
  author_name: 100,
  tags: 500,
};

/** Strip all HTML tags and control characters from a string. */
function sanitizeText(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return sanitizeHtml(raw, { allowedTags: [], allowedAttributes: {} })
    .replace(/[\x00-\x1F\x7F]/g, " ")
    .trim();
}

const PRIVATE_IP_RE =
  /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.0\.0\.0|::1|fc00:|fd[0-9a-f]{2}:)/i;

const ALLOWED_VIDEO_HOSTS = new Set([
  "youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be",
  "pornhub.com", "www.pornhub.com",
  "xvideos.com", "www.xvideos.com",
  "xhamster.com", "www.xhamster.com", "xhamster.desi",
  "redtube.com", "www.redtube.com",
  "vimeo.com", "www.vimeo.com", "player.vimeo.com",
]);

function validateUrl(raw: string): string | null {
  let url: URL;
  try { url = new URL(raw.trim()); } catch { return "video_url is not a valid URL."; }
  if (url.protocol !== "https:") return "video_url must use HTTPS.";
  const host = url.hostname.toLowerCase();
  if (PRIVATE_IP_RE.test(host)) return "video_url points to a private or local address.";
  const isDirectVideo = /\.(mp4|webm|ogg|mov)(\?.*)?$/i.test(url.pathname);
  if (!ALLOWED_VIDEO_HOSTS.has(host) && !isDirectVideo) {
    return "video_url must be from an allowed platform (YouTube, Pornhub, xVideos, xHamster, RedTube, Vimeo) or a direct .mp4/.webm link.";
  }
  return null;
}

function validateFunscriptJson(raw: unknown): string | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return "script_json must be a JSON object.";
  }
  const obj = raw as Record<string, unknown>;
  if (!Array.isArray(obj.actions)) return 'script_json must have an "actions" array.';
  for (let i = 0; i < obj.actions.length; i++) {
    const a = obj.actions[i] as Record<string, unknown>;
    if (
      typeof a !== "object" || a === null ||
      typeof a.at !== "number" || typeof a.pos !== "number" ||
      a.at < 0 || a.pos < 0 || a.pos > 100
    ) {
      return `script_json actions[${i}]: each action must have numeric "at" (≥0) and "pos" (0–100).`;
    }
  }
  return null;
}

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

router.post("/scripts", async (req: Request, res: Response) => {
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
      res.status(400).json({ error: "title, video_url, and script_json are required" });
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

router.delete("/scripts/:id", async (req: Request, res: Response) => {
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
