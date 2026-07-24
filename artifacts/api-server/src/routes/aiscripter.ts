import { Router, type Request, type Response } from "express";
import { Readable, pipeline } from "node:stream";
import { promisify } from "node:util";
import { getAuth, clerkClient } from "@clerk/express";
import { getPlan } from "../lib/getPlan";
import multer from "multer";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

const router = Router();

const AISCRIPTER_GITHUB_REPO =
  process.env.AISCRIPTER_GITHUB_REPO ?? "BurnedByAcid/haptic_os_AI_scripter";

/**
 * Releases in the repo are filtered by this tag prefix so that unrelated
 * releases (the repo hosts more than one product) are never picked up.
 */
const AISCRIPTER_TAG_PREFIX = "aiscripter-";

interface PlatformAsset {
  /** File name presented to the browser (Content-Disposition). */
  name: string;
  /** Upstream URL the server fetches from. Never sent to clients. */
  url: string;
  sizeBytes: number;
}

interface AIScripterReleaseData {
  tag: string;
  windows: PlatformAsset | null;
  macos: PlatformAsset | null;
  linux: PlatformAsset | null;
  sizeBytes: number;
}

interface AIScripterReleaseCache {
  data: AIScripterReleaseData;
  fetchedAt: number;
}

let releaseCache: AIScripterReleaseCache | null = null;
const CACHE_TTL_MS = 60 * 60 * 1000;

function githubHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github.v3+json",
    "User-Agent": "HapticOS/1.0",
  };
  if (process.env.GITHUB_TOKEN) {
    headers["Authorization"] = `token ${process.env.GITHUB_TOKEN}`;
  }
  return headers;
}

function fileNameFromUrl(url: string, fallback: string): string {
  try {
    const pathname = new URL(url).pathname;
    const base = pathname.split("/").pop();
    if (base) return decodeURIComponent(base);
  } catch {
    // fall through to fallback
  }
  return fallback;
}

/**
 * Build release data from env-var overrides so the endpoint can serve a
 * real installer even before the GitHub CI pipeline produces its first
 * release asset. The URLs are only ever fetched server-side.
 *
 * Set any combination of:
 *   AISCRIPTER_DOWNLOAD_URL_WIN=https://…/AIScripter-Setup.exe
 *   AISCRIPTER_DOWNLOAD_URL_MAC=https://…/AIScripter.dmg
 *   AISCRIPTER_DOWNLOAD_URL_LINUX=https://…/AIScripter.tar.gz
 *   AISCRIPTER_VERSION=v1.0.0
 */
function getEnvOverrideRelease(): AIScripterReleaseData | null {
  const win = process.env.AISCRIPTER_DOWNLOAD_URL_WIN ?? null;
  const mac = process.env.AISCRIPTER_DOWNLOAD_URL_MAC ?? null;
  const linux = process.env.AISCRIPTER_DOWNLOAD_URL_LINUX ?? null;
  if (!win && !mac && !linux) return null;
  return {
    tag: process.env.AISCRIPTER_VERSION ?? "latest",
    windows: win
      ? { name: fileNameFromUrl(win, "AIScripter-Setup.exe"), url: win, sizeBytes: 0 }
      : null,
    macos: mac
      ? { name: fileNameFromUrl(mac, "AIScripter.dmg"), url: mac, sizeBytes: 0 }
      : null,
    linux: linux
      ? { name: fileNameFromUrl(linux, "AIScripter.tar.gz"), url: linux, sizeBytes: 0 }
      : null,
    sizeBytes: 0,
  };
}

interface GitHubRelease {
  tag_name: string;
  draft: boolean;
  prerelease: boolean;
  assets: Array<{ name: string; browser_download_url: string; size: number }>;
}

function toReleaseData(json: GitHubRelease): AIScripterReleaseData {
  const exeAsset = json.assets.find(
    (a) => a.name === "AIScripter-Setup.exe" || a.name.toLowerCase().endsWith(".exe"),
  );
  const dmgAsset = json.assets.find((a) => a.name.toLowerCase().endsWith(".dmg"));
  const tarAsset = json.assets.find(
    (a) =>
      a.name.toLowerCase().endsWith(".tar.gz") ||
      a.name.toLowerCase().endsWith(".tar.xz"),
  );

  const primaryAsset = exeAsset ?? dmgAsset ?? tarAsset;

  const toAsset = (
    a: { name: string; browser_download_url: string; size: number } | undefined,
  ): PlatformAsset | null =>
    a ? { name: a.name, url: a.browser_download_url, sizeBytes: a.size } : null;

  return {
    tag: json.tag_name,
    windows: toAsset(exeAsset),
    macos: toAsset(dmgAsset),
    linux: toAsset(tarAsset),
    sizeBytes: primaryAsset?.size ?? 0,
  };
}

/**
 * Fetch the newest AIScripter release from GitHub.
 *
 * The repo may contain releases for other products, so this filters the
 * release list by the `aiscripter-` tag prefix instead of using
 * `releases/latest`.
 */
async function fetchAIScripterRelease(): Promise<AIScripterReleaseData> {
  const url = `https://api.github.com/repos/${AISCRIPTER_GITHUB_REPO}/releases?per_page=30`;
  const res = await fetch(url, { headers: githubHeaders() });
  if (res.status === 404) {
    return { tag: "coming-soon", windows: null, macos: null, linux: null, sizeBytes: 0 };
  }
  if (!res.ok) {
    throw new Error(`GitHub API responded with ${res.status}`);
  }

  const releases = (await res.json()) as GitHubRelease[];
  // Use the newest published release (sorted by created_at descending by GitHub).
  // The AIScripter repo only contains AIScripter releases, so no prefix filter needed.
  const match = releases.find((r) => !r.draft && !r.prerelease);
  if (!match) {
    return { tag: "coming-soon", windows: null, macos: null, linux: null, sizeBytes: 0 };
  }
  return toReleaseData(match);
}

/**
 * Returns cached release data, preferring env-var overrides over GitHub.
 * Falls back to stale cache if GitHub is unavailable.
 */
async function getRelease(): Promise<AIScripterReleaseData> {
  const envOverride = getEnvOverrideRelease();
  if (envOverride) return envOverride;

  const now = Date.now();
  if (releaseCache && now - releaseCache.fetchedAt < CACHE_TTL_MS) {
    return releaseCache.data;
  }

  try {
    const data = await fetchAIScripterRelease();
    releaseCache = { data, fetchedAt: now };
    return data;
  } catch (err) {
    if (releaseCache) {
      return releaseCache.data;
    }
    throw err;
  }
}

function assetForPlatform(
  data: AIScripterReleaseData,
  platform: string,
): PlatformAsset | null {
  return platform === "windows"
    ? data.windows
    : platform === "macos"
      ? data.macos
      : data.linux;
}

/**
 * Fetch the installer from the upstream URL server-side and stream it to
 * the client. The upstream URL never appears in any response — no
 * redirects, no JSON — so the origin of the file stays hidden.
 */
async function streamAssetToClient(
  res: Response,
  asset: PlatformAsset,
): Promise<void> {
  let upstream: globalThis.Response;
  try {
    // browser_download_url is already signed by GitHub — do NOT forward
    // Authorization headers or other GH-specific headers because the
    // actual host is often S3 and rejects them.
    upstream = await fetch(asset.url, {
      headers: {
        Accept: "application/octet-stream",
      },
      redirect: "follow",
    });
  } catch {
    res.status(502).json({ error: "Failed to reach the installer host." });
    return;
  }

  if (!upstream.ok || !upstream.body) {
    res.status(502).json({
      error: `Installer host responded with ${upstream.status}.`,
    });
    return;
  }

  res.setHeader(
    "Content-Type",
    upstream.headers.get("content-type") ?? "application/octet-stream",
  );
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${asset.name.replace(/"/g, "")}"`,
  );
  const contentLength = upstream.headers.get("content-length");
  if (contentLength) {
    res.setHeader("Content-Length", contentLength);
  }
  res.setHeader("Cache-Control", "no-store");

  // Use Readable.fromWeb + pipeline for robust error handling.
  // Readable.fromWeb handles Web ReadableStream → Node stream conversion.
  // pipeline auto-cleans up on errors and avoids memory leaks.
  const nodeStream = Readable.fromWeb(
    upstream.body as import("node:stream/web").ReadableStream,
  );
  const pipe = promisify(pipeline);
  try {
    await pipe(nodeStream, res);
  } catch {
    // pipeline already destroys both streams on error; no further action needed.
  }
}

/**
 * GET /api/aiscripter/version
 * Public endpoint — returns just the latest AIScripter version string
 * (e.g. "1.0.4") so connected daemons can check for updates without
 * requiring auth. Version is derived from the release tag by stripping
 * the "aiscripter-v" prefix.
 */
router.get("/aiscripter/version", async (_req: Request, res: Response) => {
  try {
    const data = await getRelease();
    const version = data.tag.replace(/^aiscripter-v/i, "");
    res.json({ version });
  } catch {
    res.status(502).json({ error: "Could not fetch release information." });
  }
});

/**
 * GET /api/user/aiscripter-status
 * Returns whether the current user has accepted the AIScripter EUA.
 */
router.get("/user/aiscripter-status", async (req: Request, res: Response) => {
  const auth = getAuth(req);
  if (!auth.userId) {
    res.status(401).json({ error: "Not authenticated." });
    return;
  }
  try {
    const user = await clerkClient.users.getUser(auth.userId);
    const meta = user.publicMetadata as Record<string, unknown>;
    const agreed = meta?.aiscripterAgreed === true;
    res.json({ agreed });
  } catch {
    res.status(500).json({ error: "Failed to fetch user status." });
  }
});

/**
 * POST /api/user/aiscripter-agree
 * Records that the current user has accepted the AIScripter EUA.
 * Idempotent — calling it again when already agreed is a no-op.
 */
router.post("/user/aiscripter-agree", async (req: Request, res: Response) => {
  const auth = getAuth(req);
  if (!auth.userId) {
    res.status(401).json({ error: "Not authenticated." });
    return;
  }
  try {
    await clerkClient.users.updateUserMetadata(auth.userId, {
      publicMetadata: { aiscripterAgreed: true },
    });
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "Failed to record agreement." });
  }
});

/**
 * POST /api/aiscripter/release/refresh
 * Clears the in-memory release cache so the next request re-fetches from
 * GitHub immediately. Protected by a shared secret supplied in the
 * Authorization header as a Bearer token.
 *
 * Expected env var: RELEASE_REFRESH_SECRET
 *
 * Called automatically by the GitHub Actions build workflow after each
 * new release is published.
 */
router.post("/aiscripter/release/refresh", (req: Request, res: Response) => {
  const secret = process.env.RELEASE_REFRESH_SECRET;
  if (!secret) {
    res.status(503).json({ error: "Cache refresh is not configured on this server." });
    return;
  }

  const authHeader = req.headers.authorization ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (token !== secret) {
    res.status(401).json({ error: "Invalid or missing refresh secret." });
    return;
  }

  releaseCache = null;
  res.json({ ok: true, message: "Release cache cleared." });
});

/**
 * GET /api/aiscripter/release
 * Requires Clerk auth + subscriber plan.
 *
 * Two behaviours depending on the `platform` query param:
 *
 *   • No `platform`  → returns release metadata JSON
 *     { tag, sizeBytes, platforms: { windows, macos, linux } }
 *     Used by the UI to display the version badge and available platforms.
 *
 *   • ?platform=windows|macos|linux  → streams the installer binary
 *     through this server (proxied download). The upstream source URL is
 *     never exposed to the client — no redirects, no URLs in JSON.
 */
router.get("/aiscripter/release", async (req: Request, res: Response) => {
  const auth = getAuth(req);
  if (!auth.userId) {
    res.status(401).json({ error: "Not authenticated." });
    return;
  }

  try {
    const plan = await getPlan(auth.userId);
    if (plan === "free") {
      res.status(403).json({
        error: "Subscriber plan required.",
        upgradeUrl: "/upgrade",
      });
      return;
    }
  } catch {
    res.status(500).json({ error: "Failed to verify subscription." });
    return;
  }

  const platform = (req.query.platform as string | undefined)?.toLowerCase();

  if (platform !== undefined) {
    if (!["windows", "macos", "linux"].includes(platform)) {
      res.status(400).json({ error: "platform must be windows, macos, or linux." });
      return;
    }

    let data: AIScripterReleaseData;
    try {
      data = await getRelease();
    } catch {
      res.status(502).json({ error: "Could not fetch release information." });
      return;
    }

    const asset = assetForPlatform(data, platform);
    if (!asset) {
      res.status(404).json({
        error: `No ${platform} installer is available for this release yet.`,
      });
      return;
    }

    await streamAssetToClient(res, asset);
    return;
  }

  try {
    const data = await getRelease();
    res.json({
      tag: data.tag,
      sizeBytes: data.sizeBytes,
      platforms: {
        windows: data.windows !== null,
        macos: data.macos !== null,
        linux: data.linux !== null,
      },
    });
  } catch {
    res.status(502).json({ error: "Could not fetch release information." });
  }
});

/**
 * GET /api/aiscripter/release/download?platform=windows|macos|linux
 * Auth-gated endpoint that streams the installer binary directly.
 * Requires Clerk auth + subscriber plan.
 *
 * Streams the file in a single request — no second round-trip needed.
 */
router.get("/aiscripter/release/download", async (req: Request, res: Response) => {
  const auth = getAuth(req);
  if (!auth.userId) {
    res.status(401).json({ error: "Not authenticated." });
    return;
  }

  try {
    const plan = await getPlan(auth.userId);
    if (plan === "free") {
      res.status(403).json({
        error: "Subscriber plan required.",
        upgradeUrl: "/upgrade",
      });
      return;
    }
  } catch {
    res.status(500).json({ error: "Failed to verify subscription." });
    return;
  }

  const platform = (req.query.platform as string | undefined)?.toLowerCase();
  if (!platform || !["windows", "macos", "linux"].includes(platform)) {
    res.status(400).json({ error: "platform must be windows, macos, or linux." });
    return;
  }

  let data: AIScripterReleaseData;
  try {
    data = await getRelease();
  } catch {
    res.status(502).json({ error: "Could not fetch release information." });
    return;
  }

  const asset = assetForPlatform(data, platform);
  if (!asset) {
    res.status(404).json({
      error: `No ${platform} installer is available for this release yet.`,
    });
    return;
  }

  await streamAssetToClient(res, asset);
});

/**
 * POST /api/aiscripter/upload
 * Requires Clerk auth + subscriber plan.
 *
 * Accepts a multipart video or audio file upload.  The file is saved to a
 * temporary directory and its absolute path is returned so the AIScripter
 * daemon (running locally on the user's machine) can open it directly.
 *
 * Files are scheduled for deletion after 2 hours.
 */

const UPLOAD_TEMP_DIR = path.join(os.tmpdir(), "hapticos-aiscripter-uploads");
try { fs.mkdirSync(UPLOAD_TEMP_DIR, { recursive: true }); } catch { /* already exists */ }

// Schedule cleanup of temp uploads after 2 hours
setInterval(() => {
  const cutoffMs = 2 * 60 * 60 * 1000;
  try {
    const now = Date.now();
    for (const entry of fs.readdirSync(UPLOAD_TEMP_DIR)) {
      const p = path.join(UPLOAD_TEMP_DIR, entry);
      try {
        const stat = fs.statSync(p);
        if (now - stat.mtimeMs > cutoffMs) fs.unlinkSync(p);
      } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
}, 30 * 60 * 1000).unref();

const aiscripterUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOAD_TEMP_DIR),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase() || ".bin";
      cb(null, `${crypto.randomUUID()}${ext}`);
    },
  }),
  limits: { fileSize: 2 * 1024 * 1024 * 1024 }, // 2 GB
  fileFilter: (_req, file, cb) => {
    const allowed = new Set([
      "video/mp4", "video/x-matroska", "video/x-msvideo", "video/quicktime",
      "video/x-ms-wmv", "video/webm", "video/x-m4v",
      "audio/mpeg", "audio/wav", "audio/ogg", "audio/aac", "audio/flac",
      "audio/x-flac", "audio/mp4",
    ]);
    // Also allow by extension if MIME is generic
    const ext = path.extname(file.originalname).toLowerCase();
    const allowedExts = new Set([
      ".mp4", ".mkv", ".avi", ".mov", ".wmv", ".webm", ".m4v",
      ".mp3", ".wav", ".ogg", ".aac", ".flac", ".m4a",
    ]);
    if (allowed.has(file.mimetype) || allowedExts.has(ext)) {
      cb(null, true);
    } else {
      cb(new Error("Unsupported file type. Upload a video or audio file."));
    }
  },
});

// Auth + plan gate runs BEFORE multer so unauthenticated requests never write to disk.
async function requireAiscripterUploadAuth(req: Request, res: Response, next: () => void) {
  const auth = getAuth(req);
  if (!auth.userId) {
    res.status(401).json({ error: "Not authenticated." });
    return;
  }
  try {
    const plan = await getPlan(auth.userId);
    if (plan === "free") {
      res.status(403).json({ error: "Subscriber plan required." });
      return;
    }
  } catch {
    res.status(500).json({ error: "Failed to verify subscription." });
    return;
  }
  next();
}

router.post(
  "/aiscripter/upload",
  requireAiscripterUploadAuth as Parameters<typeof router.post>[1],
  aiscripterUpload.single("file"),
  (req: Request, res: Response) => {
    if (!req.file) {
      res.status(400).json({ error: "No file provided. Include a 'file' field in the multipart body." });
      return;
    }
    res.json({
      path: req.file.path,
      filename: req.file.originalname,
      sizeBytes: req.file.size,
    });
  },
);

export default router;
