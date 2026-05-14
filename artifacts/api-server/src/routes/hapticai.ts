import { Router, type Request, type Response, type NextFunction } from "express";
import { getAuth, clerkClient } from "@clerk/express";
import multer from "multer";
import { pool } from "../lib/db";
import { getPlan } from "../lib/getPlan";
import { uploadReleaseToGCS, downloadReleaseFromGCS } from "../lib/hapticaiStorage";
import { logger } from "../lib/logger";

const router = Router();

// ---------------------------------------------------------------------------
// GitHub release proxy — cached in-memory for 1 h to avoid rate-limit hits
// ---------------------------------------------------------------------------

const GITHUB_REPO =
  process.env.HAPTICAI_GITHUB_REPO ??
  "HapticAI/HapticAI-Powered-Funscript-Generator";

interface GitHubReleaseCache {
  data: {
    tag: string;
    exeUrl: string | null;
    dmgUrl: string | null;
  };
  fetchedAt: number;
}

let githubReleaseCache: GitHubReleaseCache | null = null;
const GITHUB_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

async function fetchLatestGithubRelease(): Promise<GitHubReleaseCache["data"]> {
  const url = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;
  const headers: Record<string, string> = {
    Accept: "application/vnd.github.v3+json",
    "User-Agent": "HapticOS/1.0",
  };
  if (process.env.GITHUB_TOKEN) {
    headers["Authorization"] = `token ${process.env.GITHUB_TOKEN}`;
  }

  const res = await fetch(url, { headers });
  if (!res.ok) {
    throw new Error(`GitHub API responded with ${res.status}`);
  }

  const json = (await res.json()) as {
    tag_name: string;
    assets: Array<{ name: string; browser_download_url: string }>;
  };

  // Prefer exact well-known filename first; fall back to extension match so
  // the endpoint keeps working if the file is ever renamed.
  const exeAsset =
    json.assets.find((a) => a.name === "HapticAI-Setup.exe") ??
    json.assets.find((a) => a.name.toLowerCase().endsWith(".exe"));
  const dmgAsset =
    json.assets.find((a) => a.name.toLowerCase().endsWith(".dmg"));

  return {
    tag: json.tag_name,
    exeUrl: exeAsset?.browser_download_url ?? null,
    dmgUrl: dmgAsset?.browser_download_url ?? null,
  };
}

/**
 * GET /api/hapticai/github-release
 * Public. Returns the latest GitHub Release tag and direct asset download URLs.
 * Response: { tag: string, exeUrl: string|null, dmgUrl: string|null }
 * Cached server-side for 1 hour to stay within GitHub API rate limits.
 */
router.get("/hapticai/github-release", async (_req: Request, res: Response) => {
  try {
    const now = Date.now();
    if (
      githubReleaseCache &&
      now - githubReleaseCache.fetchedAt < GITHUB_CACHE_TTL_MS
    ) {
      res.json(githubReleaseCache.data);
      return;
    }

    const data = await fetchLatestGithubRelease();
    githubReleaseCache = { data, fetchedAt: now };
    res.json(data);
  } catch (err) {
    logger.warn({ err }, "Failed to fetch latest GitHub release");
    // Return cached data if available, even if stale
    if (githubReleaseCache) {
      res.json(githubReleaseCache.data);
      return;
    }
    // No releases published yet (or repo is private/empty) — return a null
    // result so clients can handle it gracefully instead of seeing a 502.
    res.json({ tag: null, exeUrl: null, dmgUrl: null });
  }
});

/**
 * Middleware: allows the request only when the caller is authorised as an
 * admin via ONE of two mechanisms (checked in order, runs BEFORE multer so
 * unauthenticated callers never cause the server to buffer the request body):
 *
 * 1. Static bearer token — Authorization: Bearer $HAPTICAI_ADMIN_TOKEN
 *    (preserves backward-compat with existing curl-based upload scripts)
 *
 * 2. Clerk JWT with admin plan — the browser admin panel sends its session
 *    token; the HAPTICAI_ADMIN_TOKEN never leaves the server.
 */
async function adminAuthMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
  // --- Method 1: static HAPTICAI_ADMIN_TOKEN (curl / CI) ---
  const adminToken = process.env.HAPTICAI_ADMIN_TOKEN;
  const authHeader = req.headers.authorization ?? "";
  const provided = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (adminToken && provided === adminToken) {
    next();
    return;
  }

  // --- Method 2: Clerk JWT with admin plan (browser admin panel) ---
  const auth = getAuth(req);
  if (auth.userId) {
    try {
      const user = await clerkClient.users.getUser(auth.userId);
      if ((user.publicMetadata as Record<string, unknown>)?.plan === "admin") {
        next();
        return;
      }
    } catch {
      // fall through to rejection
    }
  }

  // Neither method succeeded
  if (!adminToken) {
    res.status(503).json({ error: "Admin uploads not configured on this server." });
  } else {
    res.status(403).json({ error: "Invalid admin token or insufficient permissions." });
  }
}

/**
 * Multer instance for individual chunks.
 * Memory storage so we get req.file.buffer directly — no temp-file pipelines.
 * Cap at 4 MB (chunks are sent as 2 MB slices) to stay well inside any proxy limit.
 */
const chunkUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 4 * 1024 * 1024 },
});

/**
 * POST /api/hapticai/upload-chunk
 * Admin-only. Chunked upload endpoint that bypasses the Replit proxy body-size
 * limit.  The browser splits the file into 2 MB slices and POSTs them one at a
 * time; each chunk is appended to a stable temp file on disk.  The final chunk
 * triggers a GCS stream-upload and a DB insert.
 *
 * Body (multipart/form-data):
 *   platform     "windows" | "mac"
 *   version      semver tag, e.g. "v1.2.0"
 *   chunkIndex   0-based index of this chunk
 *   totalChunks  total number of chunks
 *   chunk        the binary slice (≤ 2 MB)
 */
router.post(
  "/hapticai/upload-chunk",
  adminAuthMiddleware,
  chunkUpload.single("chunk"),
  async (req: Request, res: Response) => {
    const { platform, version, chunkIndex: ciRaw, totalChunks: tcRaw } =
      req.body as { platform?: string; version?: string; chunkIndex?: string; totalChunks?: string };

    if (!platform || !["windows", "mac"].includes(platform)) {
      res.status(400).json({ error: "platform must be 'windows' or 'mac'." });
      return;
    }
    if (!version || !/^v?\d+\.\d+/.test(version)) {
      res.status(400).json({ error: "version must be a semver tag (e.g. v1.0.0)." });
      return;
    }
    const chunkIndex = parseInt(ciRaw ?? "", 10);
    const totalChunks = parseInt(tcRaw ?? "", 10);
    if (isNaN(chunkIndex) || isNaN(totalChunks) || chunkIndex < 0 || totalChunks < 1) {
      res.status(400).json({ error: "chunkIndex and totalChunks must be valid integers." });
      return;
    }
    if (!req.file?.buffer?.length) {
      res.status(400).json({ error: "No chunk data received." });
      return;
    }

    const { tmpdir } = await import("os");
    const { join } = await import("path");
    const { appendFile, writeFile, stat, unlink } = await import("fs/promises");
    const { createReadStream } = await import("fs");

    const safeVersion = version.replace(/[^a-zA-Z0-9._-]/g, "_");
    const assemblyPath = join(tmpdir(), `hapticai-upload-${platform}-${safeVersion}.bin`);

    try {
      // First chunk: overwrite; subsequent chunks: append
      if (chunkIndex === 0) {
        await writeFile(assemblyPath, req.file.buffer);
      } else {
        await appendFile(assemblyPath, req.file.buffer);
      }

      logger.info(
        { platform, version, chunkIndex, totalChunks, bytes: req.file.buffer.length },
        "HapticAI chunk received",
      );

      // Not the last chunk — just acknowledge
      if (chunkIndex < totalChunks - 1) {
        res.json({ ok: true, received: chunkIndex + 1, totalChunks });
        return;
      }

      // ── Final chunk: upload assembled file to GCS, record in DB ──
      const { size: sizeBytes } = await stat(assemblyPath);
      const contentType =
        platform === "windows"
          ? "application/vnd.microsoft.portable-executable"
          : "application/x-apple-diskimage";

      const fileStream = createReadStream(assemblyPath);
      const { storageKey } = await uploadReleaseToGCS(platform, version, fileStream, contentType);

      await pool.query(
        `INSERT INTO hapticai_releases (platform, version, size_bytes, storage_key)
         VALUES ($1, $2, $3, $4)`,
        [platform, version, sizeBytes, storageKey],
      );

      logger.info({ platform, version, sizeBytes, storageKey }, "HapticAI release uploaded (chunked)");
      res.json({ ok: true, platform, version, sizeBytes, storageKey });
    } catch (err) {
      logger.error({ err }, "HapticAI chunk upload failed");
      res.status(500).json({ error: "Chunk upload failed. Check server logs." });
    } finally {
      if (chunkIndex === totalChunks - 1) {
        unlink(assemblyPath).catch(() => {});
      }
    }
  },
);

/**
 * POST /api/hapticai/upload  (legacy single-request upload — kept for curl/CI)
 * Admin-only. Accepts a full multipart .exe/.dmg upload in one request.
 * Only suitable for small files or direct server-to-server calls that don't
 * pass through the Replit reverse proxy.
 */
const upload = multer({
  storage: multer.diskStorage({}),
  limits: { fileSize: 600 * 1024 * 1024 },
});

router.post(
  "/hapticai/upload",
  adminAuthMiddleware,
  upload.single("file"),
  async (req: Request, res: Response) => {
    const { platform, version } = req.body as { platform?: string; version?: string };
    if (!platform || !["windows", "mac"].includes(platform)) {
      res.status(400).json({ error: "platform must be 'windows' or 'mac'." });
      return;
    }
    if (!version || !/^v?\d+\.\d+/.test(version)) {
      res.status(400).json({
        error: "version is required and must look like a semver tag (e.g. v1.0.0).",
      });
      return;
    }
    if (!req.file) {
      res.status(400).json({ error: "No file uploaded. Include a 'file' field in the multipart body." });
      return;
    }

    const expectedExt = platform === "windows" ? ".exe" : ".dmg";
    const uploadedName = (req.file.originalname ?? "").toLowerCase();
    if (!uploadedName.endsWith(expectedExt)) {
      res.status(400).json({
        error: `File for platform '${platform}' must have extension '${expectedExt}'. Got: ${req.file.originalname}`,
      });
      return;
    }

    try {
      const { createReadStream } = await import("fs");
      const fileStream = createReadStream(req.file.path);
      const contentType =
        platform === "windows"
          ? "application/vnd.microsoft.portable-executable"
          : "application/x-apple-diskimage";

      const { storageKey, sizeBytes } = await uploadReleaseToGCS(
        platform,
        version,
        fileStream,
        contentType,
      );

      await pool.query(
        `INSERT INTO hapticai_releases (platform, version, size_bytes, storage_key)
         VALUES ($1, $2, $3, $4)`,
        [platform, version, sizeBytes, storageKey],
      );

      logger.info({ platform, version, sizeBytes, storageKey }, "HapticAI release uploaded");
      res.json({ ok: true, platform, version, sizeBytes, storageKey });
    } catch (err) {
      logger.error({ err }, "Failed to upload HapticAI release");
      res.status(500).json({ error: "Upload failed. Check server logs." });
    } finally {
      if (req.file?.path) {
        import("fs").then(({ unlink }) => unlink(req.file!.path, () => {})).catch(() => {});
      }
    }
  },
);

/**
 * GET /api/hapticai/release
 * Public. Returns the latest available release info for each platform.
 * Shape: { available: boolean, version?: string, windows?: { sizeBytes }, mac?: { sizeBytes } | null }
 */
router.get("/hapticai/release", async (_req: Request, res: Response) => {
  try {
    const { rows } = await pool.query<{
      platform: string;
      version: string;
      size_bytes: string;
    }>(
      `SELECT DISTINCT ON (platform) platform, version, size_bytes
       FROM hapticai_releases
       ORDER BY platform, uploaded_at DESC`,
    );

    if (rows.length === 0) {
      res.json({ available: false });
      return;
    }

    const windows = rows.find((r) => r.platform === "windows");
    const mac = rows.find((r) => r.platform === "mac");
    const version = (windows ?? mac)?.version ?? "";

    res.json({
      available: true,
      version,
      windows: windows ? { sizeBytes: Number(windows.size_bytes) } : null,
      mac: mac ? { sizeBytes: Number(mac.size_bytes) } : null,
    });
  } catch (err) {
    logger.error({ err }, "Failed to fetch HapticAI release info");
    res.status(500).json({ error: "Failed to fetch release info." });
  }
});

const SUBSCRIBER_PLANS = new Set(["subscriber", "pro", "admin"]);

/**
 * GET /api/hapticai/download/:platform
 * Subscriber-only. Streams the latest release binary for the given platform
 * directly from object storage. Requires a valid Clerk JWT and an active
 * subscription (subscriber / pro / admin plan).
 */
router.get("/hapticai/download/:platform", async (req: Request, res: Response) => {
  const auth = getAuth(req);
  if (!auth.userId) {
    res.status(401).json({ error: "Not authenticated. Please sign in to download HapticAI." });
    return;
  }

  const plan = (await getPlan(auth.userId)).toLowerCase();
  if (!SUBSCRIBER_PLANS.has(plan)) {
    res.status(403).json({
      error: "Subscription required.",
      message: "HapticAI is available to subscribers. Upgrade to access downloads.",
      upgradeUrl: "/upgrade",
    });
    return;
  }

  const { platform } = req.params;
  if (!["windows", "mac"].includes(platform)) {
    res.status(400).json({ error: "Unknown platform. Use 'windows' or 'mac'." });
    return;
  }

  try {
    // ── Prefer GitHub release (fast CDN redirect, no storage costs) ──────────
    try {
      const ghData = await fetchLatestGithubRelease();
      const ghUrl = platform === "windows" ? ghData.exeUrl : ghData.dmgUrl;
      if (ghUrl) {
        logger.info({ platform, tag: ghData.tag }, "HapticAI download — redirecting to GitHub release");
        res.redirect(302, ghUrl);
        return;
      }
    } catch (ghErr) {
      // GitHub unreachable or no release published yet — fall through to GCS
      logger.warn({ ghErr }, "GitHub release fetch failed, falling back to GCS");
    }

    // ── Fallback: stream from GCS ─────────────────────────────────────────────
    const { rows } = await pool.query<{ storage_key: string; version: string }>(
      `SELECT storage_key, version FROM hapticai_releases
       WHERE platform = $1
       ORDER BY uploaded_at DESC
       LIMIT 1`,
      [platform],
    );

    if (rows.length === 0) {
      res.status(404).json({
        error: "No release available yet for this platform.",
        message:
          "The HapticAI download for this platform is not yet available. Please contact support.",
      });
      return;
    }

    const { storage_key: storageKey, version } = rows[0];
    const filename =
      platform === "windows"
        ? `HapticAI-Setup-${version}.exe`
        : `HapticAI-${version}.dmg`;

    // Parse the Range header (only "bytes=<start>-" and "bytes=<start>-<end>" are supported)
    const rawRange = req.headers["range"];
    const rangeHeader = Array.isArray(rawRange) ? rawRange[0] : rawRange;
    let startOffset = 0;
    let endOffset = -1;
    let isRangeRequest = false;

    if (rangeHeader && rangeHeader.startsWith("bytes=")) {
      const rangeSpec = rangeHeader.slice(6);
      const match = /^(\d+)-(\d*)$/.exec(rangeSpec);
      if (match) {
        startOffset = parseInt(match[1], 10);
        endOffset = match[2] ? parseInt(match[2], 10) : -1;
        isRangeRequest = true;
      } else {
        res.status(416).setHeader("Content-Range", "bytes */*").end();
        return;
      }
    }

    const { stream, contentType, sizeBytes } = await downloadReleaseFromGCS(
      storageKey,
      startOffset,
      endOffset,
    );

    if (isRangeRequest && sizeBytes > 0) {
      const isInvalidStart = isNaN(startOffset) || startOffset < 0 || startOffset >= sizeBytes;
      const isInvalidEnd = endOffset >= 0 && (isNaN(endOffset) || endOffset < startOffset);
      if (isInvalidStart || isInvalidEnd) {
        res.status(416).setHeader("Content-Range", `bytes */${sizeBytes}`).end();
        return;
      }
    }

    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Accept-Ranges", "bytes");

    if (isRangeRequest && sizeBytes > 0) {
      const rangeEnd = endOffset >= 0 ? Math.min(endOffset, sizeBytes - 1) : sizeBytes - 1;
      const chunkSize = rangeEnd - startOffset + 1;
      res.setHeader("Content-Range", `bytes ${startOffset}-${rangeEnd}/${sizeBytes}`);
      res.setHeader("Content-Length", String(chunkSize));
      res.status(206);
    } else {
      if (sizeBytes > 0) res.setHeader("Content-Length", String(sizeBytes));
    }

    stream.pipe(res);
    stream.on("error", (err) => {
      logger.error({ err }, "Stream error during HapticAI download");
      if (!res.headersSent) res.status(500).json({ error: "Download failed." });
    });
  } catch (err) {
    logger.error({ err }, "Failed to serve HapticAI download");
    if (!res.headersSent) {
      res.status(500).json({
        error: "Download failed. Please try again or contact support.",
      });
    }
  }
});

/**
 * GET /api/user/hapticai-status
 * Returns whether the current user has accepted the HapticAI EUA.
 */
router.get("/user/hapticai-status", async (req: Request, res: Response) => {
  const auth = getAuth(req);
  if (!auth.userId) {
    res.status(401).json({ error: "Not authenticated." });
    return;
  }
  try {
    const user = await clerkClient.users.getUser(auth.userId);
    const meta = user.publicMetadata as Record<string, unknown>;
    const agreed = meta?.hapticaiAgreed === true || meta?.fungenAgreed === true;
    res.json({ agreed });
  } catch {
    res.status(500).json({ error: "Failed to fetch user status." });
  }
});

/**
 * POST /api/user/hapticai-agree
 * Records that the current user has accepted the HapticAI EUA.
 * Idempotent — calling it again when already agreed is a no-op.
 */
router.post("/user/hapticai-agree", async (req: Request, res: Response) => {
  const auth = getAuth(req);
  if (!auth.userId) {
    res.status(401).json({ error: "Not authenticated." });
    return;
  }
  try {
    await clerkClient.users.updateUserMetadata(auth.userId, {
      publicMetadata: { hapticaiAgreed: true },
    });
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "Failed to record agreement." });
  }
});

/**
 * GET /api/user/preferences
 * Returns the current user's persisted UI preferences from the DB.
 */
router.get("/user/preferences", async (req: Request, res: Response) => {
  const auth = getAuth(req);
  if (!auth.userId) {
    res.status(401).json({ error: "Not authenticated." });
    return;
  }
  try {
    const { rows } = await pool.query(
      `SELECT haptic_ai_warn_dismissed FROM users WHERE clerk_id = $1 LIMIT 1`,
      [auth.userId],
    );
    const hapticAiWarnDismissed =
      rows.length > 0 ? rows[0].haptic_ai_warn_dismissed === true : false;
    res.json({ hapticAiWarnDismissed });
  } catch {
    res.status(500).json({ error: "Failed to fetch preferences." });
  }
});

/**
 * POST /api/user/preferences
 * Body: { hapticAiWarnDismissed?: boolean }
 * Persists one or more user UI preferences to the DB.
 */
router.post("/user/preferences", async (req: Request, res: Response) => {
  const auth = getAuth(req);
  if (!auth.userId) {
    res.status(401).json({ error: "Not authenticated." });
    return;
  }
  const { hapticAiWarnDismissed } = req.body as { hapticAiWarnDismissed?: unknown };
  if (hapticAiWarnDismissed !== true && hapticAiWarnDismissed !== false) {
    res.status(400).json({ error: "No valid preference fields provided." });
    return;
  }
  try {
    await pool.query(
      `UPDATE users SET haptic_ai_warn_dismissed = $2 WHERE clerk_id = $1`,
      [auth.userId, hapticAiWarnDismissed],
    );
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "Failed to save preferences." });
  }
});

export default router;
