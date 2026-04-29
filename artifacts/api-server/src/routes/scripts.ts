import { Router, type Request, type Response } from "express";
import { pool } from "../lib/db";

const router = Router();

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
    if (!rows.length) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    await pool.query(`UPDATE shared_scripts SET downloads = downloads + 1 WHERE id = $1`, [req.params.id]);
    res.json(rows[0]);
  } catch {
    res.status(500).json({ error: "Failed to fetch script" });
  }
});

router.post("/scripts", async (req: Request, res: Response) => {
  try {
    const { title, description, video_url, script_json, author_id, author_name, tags } = req.body as Record<string, string>;
    if (!title || !video_url || !script_json) {
      res.status(400).json({ error: "title, video_url, and script_json are required" });
      return;
    }
    const { rows } = await pool.query(
      `INSERT INTO shared_scripts (title, description, video_url, script_json, author_id, author_name, tags)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, title, description, video_url, author_name, tags, downloads, created_at`,
      [title, description || "", video_url, script_json, author_id || null, author_name || "Anonymous", tags || ""]
    );
    res.status(201).json(rows[0]);
  } catch {
    res.status(500).json({ error: "Failed to save script" });
  }
});

router.delete("/scripts/:id", async (req: Request, res: Response) => {
  try {
    const { author_id } = req.body as { author_id?: string };
    if (!author_id) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const { rowCount } = await pool.query(
      `DELETE FROM shared_scripts WHERE id = $1 AND author_id = $2`,
      [req.params.id, author_id]
    );
    if (!rowCount) {
      res.status(404).json({ error: "Not found or not your script" });
      return;
    }
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "Failed to delete script" });
  }
});

export default router;
