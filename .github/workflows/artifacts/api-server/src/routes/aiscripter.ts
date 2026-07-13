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
 * Proxies the latest GitHub release for AIScripter (cached 1 h).
 * Requires Clerk auth + subscriber plan.
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

  const now = Date.now();
  if (releaseCache && now - releaseCache.fetchedAt < CACHE_TTL_MS) {
    res.json(releaseCache.data);
    return;
  }

  try {
    const data = await fetchLatestRelease();
    releaseCache = { data, fetchedAt: now };
    res.json(data);
  } catch (err) {
    if (releaseCache) {
      res.json(releaseCache.data);
      return;
    }
    res.status(502).json({ error: "Could not fetch release information." });
  }
});

export default router;
