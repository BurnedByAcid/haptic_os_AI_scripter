import { Router, type Request, type Response } from "express";
import { getAuth, clerkClient } from "@clerk/express";
import { getPlan } from "../lib/getPlan";

const router = Router();

const AISCRIPTER_GITHUB_REPO =
  process.env.AISCRIPTER_GITHUB_REPO ?? "HapticOS/AIScripter";

interface AIScripterReleaseCache {
  data: {
    tag: string;
    exeUrl: string | null;
    dmgUrl: string | null;
    tarballUrl: string | null;
    sizeBytes: number;
  };
  fetchedAt: number;
}

let releaseCache: AIScripterReleaseCache | null = null;
const CACHE_TTL_MS = 60 * 60 * 1000;

/**
 * Build release data from env-var overrides so the endpoint can serve a
 * real installer URL even before the GitHub CI pipeline produces its first
 * release asset.
 *
 * Set any combination of:
 *   AISCRIPTER_DOWNLOAD_URL_WIN=https://…/AIScripter-Setup.exe
 *   AISCRIPTER_DOWNLOAD_URL_MAC=https://…/AIScripter.dmg
 *   AISCRIPTER_DOWNLOAD_URL_LINUX=https://…/AIScripter.tar.gz
 *   AISCRIPTER_VERSION=v1.0.0
 */
function getEnvOverrideRelease(): AIScripterReleaseCache["data"] | null {
  const win = process.env.AISCRIPTER_DOWNLOAD_URL_WIN ?? null;
  const mac = process.env.AISCRIPTER_DOWNLOAD_URL_MAC ?? null;
  const linux = process.env.AISCRIPTER_DOWNLOAD_URL_LINUX ?? null;
  if (!win && !mac && !linux) return null;
  return {
    tag: process.env.AISCRIPTER_VERSION ?? "latest",
    exeUrl: win,
    dmgUrl: mac,
    tarballUrl: linux,
    sizeBytes: 0,
  };
}

async function fetchLatestRelease(): Promise<AIScripterReleaseCache["data"]> {
  const url = `https://api.github.com/repos/${AISCRIPTER_GITHUB_REPO}/releases/latest`;
  const headers: Record<string, string> = {
    Accept: "application/vnd.github.v3+json",
    "User-Agent": "HapticOS/1.0",
  };
  if (process.env.GITHUB_TOKEN) {
    headers["Authorization"] = `token ${process.env.GITHUB_TOKEN}`;
  }

  const res = await fetch(url, { headers });
  if (res.status === 404) {
    return {
      tag: "coming-soon",
      exeUrl: null,
      dmgUrl: null,
      tarballUrl: null,
      sizeBytes: 0,
    };
  }
  if (!res.ok) {
    throw new Error(`GitHub API responded with ${res.status}`);
  }

  const json = (await res.json()) as {
    tag_name: string;
    assets: Array<{ name: string; browser_download_url: string; size: number }>;
  };

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

  return {
    tag: json.tag_name,
    exeUrl: exeAsset?.browser_download_url ?? null,
    dmgUrl: dmgAsset?.browser_download_url ?? null,
    tarballUrl: tarAsset?.browser_download_url ?? null,
    sizeBytes: primaryAsset?.size ?? 0,
  };
}

/**
 * Returns cached release data, preferring env-var overrides over GitHub.
 * Falls back to stale cache if GitHub is unavailable.
 */
async function getRelease(): Promise<AIScripterReleaseCache["data"]> {
  const envOverride = getEnvOverrideRelease();
  if (envOverride) return envOverride;

  const now = Date.now();
  if (releaseCache && now - releaseCache.fetchedAt < CACHE_TTL_MS) {
    return releaseCache.data;
  }

  try {
    const data = await fetchLatestRelease();
    releaseCache = { data, fetchedAt: now };
    return data;
  } catch (err) {
    if (releaseCache) {
      return releaseCache.data;
    }
    throw err;
  }
}

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
 * GET /api/aiscripter/release
 * Requires Clerk auth + subscriber plan.
 *
 * Two behaviours depending on the `platform` query param:
 *
 *   • No `platform`  → returns release metadata JSON
 *     { tag, sizeBytes, platforms: { windows, macos, linux } }
 *     Used by the UI to display the version badge and available platforms.
 *
 *   • ?platform=windows|macos|linux  → 302 redirect to the real installer
 *     download URL (GitHub release asset or env-var override).
 *     This is the primary download path; the redirect target is the actual
 *     binary so the browser immediately prompts for a file save.
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

    let data: AIScripterReleaseCache["data"];
    try {
      data = await getRelease();
    } catch {
      res.status(502).json({ error: "Could not fetch release information." });
      return;
    }

    const downloadUrl =
      platform === "windows" ? data.exeUrl :
      platform === "macos"   ? data.dmgUrl :
                               data.tarballUrl;

    if (!downloadUrl) {
      res.status(404).json({
        error: `No ${platform} installer is available for this release yet.`,
      });
      return;
    }

    res.redirect(302, downloadUrl);
    return;
  }

  try {
    const data = await getRelease();
    res.json({
      tag: data.tag,
      sizeBytes: data.sizeBytes,
      platforms: {
        windows: data.exeUrl !== null,
        macos: data.dmgUrl !== null,
        linux: data.tarballUrl !== null,
      },
    });
  } catch {
    res.status(502).json({ error: "Could not fetch release information." });
  }
});

/**
 * GET /api/aiscripter/release/download?platform=windows|macos|linux
 * Auth-gated endpoint that returns the signed download URL for the installer.
 * Requires Clerk auth + subscriber plan.
 *
 * Returns { url: string, tag: string } so the client can trigger a real
 * browser file download without the raw asset URL ever appearing in the
 * page's JS context before the auth check completes.
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

  let data: AIScripterReleaseCache["data"];
  try {
    data = await getRelease();
  } catch {
    res.status(502).json({ error: "Could not fetch release information." });
    return;
  }

  const downloadUrl =
    platform === "windows" ? data.exeUrl :
    platform === "macos"   ? data.dmgUrl :
                             data.tarballUrl;

  if (!downloadUrl) {
    res.status(404).json({
      error: `No ${platform} installer is available for this release yet.`,
    });
    return;
  }

  res.json({ url: downloadUrl, tag: data.tag });
});

export default router;
