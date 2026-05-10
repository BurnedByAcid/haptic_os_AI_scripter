import { Router, type Request, type Response, type NextFunction } from "express";
import { getAuth, clerkClient } from "@clerk/express";
import multer from "multer";
import { pool } from "../lib/db";
import { uploadReleaseToGCS, downloadReleaseFromGCS } from "../lib/hapticaiStorage";
import { logger } from "../lib/logger";

const router = Router();

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
 * Multer instance used only inside the authenticated upload handler.
 * Streams to disk temp files to avoid large in-memory buffers.
 */
const upload = multer({
  storage: multer.diskStorage({}),
  limits: { fileSize: 600 * 1024 * 1024 },
});

/**
 * POST /api/hapticai/upload
 * Admin-only. Accepts a multipart .exe upload, stores it in object storage,
 * and records the release in the hapticai_releases table.
 *
 * Requires: Authorization: Bearer $HAPTICAI_ADMIN_TOKEN
 * Body (multipart/form-data): platform (string), version (string), file (binary)
 *
 * Auth middleware runs BEFORE multer so unauthenticated requests are rejected
 * before any body bytes are read.
 */
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
      // Clean up the temp file multer wrote to disk
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

/**
 * GET /api/hapticai/download/:platform
 * Public. Streams the latest release binary for the given platform directly
 * from object storage so the file downloads from the HapticOS domain.
 */
router.get("/hapticai/download/:platform", async (req: Request, res: Response) => {
  const { platform } = req.params;
  if (!["windows", "mac"].includes(platform)) {
    res.status(400).json({ error: "Unknown platform. Use 'windows' or 'mac'." });
    return;
  }

  try {
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

    const { stream, contentType, sizeBytes } = await downloadReleaseFromGCS(storageKey);

    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Type", contentType);
    if (sizeBytes > 0) res.setHeader("Content-Length", String(sizeBytes));
    res.setHeader("Cache-Control", "no-store");

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
