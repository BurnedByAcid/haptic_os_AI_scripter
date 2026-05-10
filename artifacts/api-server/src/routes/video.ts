import { Router, type Request, type Response } from "express";
import { getAuth } from "@clerk/express";
import { execFile } from "child_process";
import { promisify } from "util";
import http from "http";
import https from "https";
import { videoResolveLimiter } from "../middlewares/rateLimiters";

const execFileAsync = promisify(execFile);
const router = Router();

const YTDLP_BIN = "/home/runner/workspace/.pythonlibs/bin/yt-dlp";

// ── Token store ───────────────────────────────────────────────────────────────
interface TokenEntry {
  userId: string;
  cdnUrl: string;
  allowedHostname: string;
  expiresAt: number;
  isHls?: boolean;
  hlsBaseUrl?: string;
}
const tokenStore = new Map<string, TokenEntry>();
const TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

setInterval(() => {
  const now = Date.now();
  for (const [t, e] of tokenStore) if (e.expiresAt <= now) tokenStore.delete(t);
}, 10 * 60 * 1000).unref();

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Returns true only if `url` is an http/https URL whose hostname exactly
 * matches the token's recorded upstream hostname.  This prevents the
 * sub-manifest and segment helpers from being used as a general-purpose SSRF
 * proxy: callers cannot redirect them at internal hosts, cloud-metadata
 * endpoints, or any CDN origin that differs from the one resolved at token
 * creation time.
 */
function isHostAllowed(url: string, allowedHostname: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      parsed.hostname === allowedHostname
    );
  } catch {
    return false;
  }
}

/**
 * Verify that the request's authenticated Clerk user matches the user who
 * originally minted the token.  Returns true when the check passes; writes a
 * 401 response and returns false otherwise.
 */
function verifyTokenOwner(req: Request, res: Response, entry: TokenEntry): boolean {
  const auth = getAuth(req);
  if (!auth.userId || auth.userId !== entry.userId) {
    res.status(401).json({ error: "Not authenticated or token belongs to a different user." });
    return false;
  }
  return true;
}

function proxyUpstream(
  cdnUrl: string,
  req: Request,
  res: Response,
  extraHeaders: Record<string, string> = {}
): void {
  const upstreamHeaders: Record<string, string> = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept": "*/*",
    "Referer": new URL(cdnUrl).origin + "/",
    ...extraHeaders,
  };
  if (req.headers["range"]) upstreamHeaders["Range"] = req.headers["range"] as string;

  const lib = cdnUrl.startsWith("https") ? https : http;
  const upstream = lib.request(cdnUrl, { headers: upstreamHeaders, method: "GET" }, (uRes) => {
    const origin = req.headers["origin"];
    if (origin) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
    }
    res.setHeader("Access-Control-Allow-Headers", "Range, Authorization");
    res.setHeader("Access-Control-Expose-Headers", "Content-Range, Content-Length, Accept-Ranges");

    for (const h of ["content-type", "content-length", "content-range", "accept-ranges"] as const) {
      const v = uRes.headers[h];
      if (v) res.setHeader(h, v);
    }
    res.status(uRes.statusCode ?? 200);
    uRes.pipe(res);
  });

  upstream.on("error", (e) => {
    if (!res.headersSent) res.status(502).json({ error: "Upstream error: " + e.message });
  });
  req.on("close", () => upstream.destroy());
  upstream.end();
}

function fetchText(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https") ? https : http;
    const reqOpts = {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept": "*/*",
        "Referer": new URL(url).origin + "/",
      },
    };
    const req = lib.request(url, reqOpts, (res) => {
      if ((res.statusCode ?? 0) >= 400) {
        reject(new Error(`Upstream returned ${res.statusCode}`));
        res.resume();
        return;
      }
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => { body += chunk; });
      res.on("end", () => resolve(body));
    });
    req.on("error", reject);
    req.end();
  });
}

// ── GET /api/video/resolve ────────────────────────────────────────────────────
router.get("/video/resolve", videoResolveLimiter, async (req: Request, res: Response) => {
  const auth = getAuth(req);
  if (!auth.userId) { res.status(401).json({ error: "Not authenticated" }); return; }

  const pageUrl = (req.query.url as string | undefined)?.trim();
  if (!pageUrl) { res.status(400).json({ error: "Missing url parameter" }); return; }

  let parsed: URL;
  try { parsed = new URL(pageUrl); } catch {
    res.status(400).json({ error: "Invalid URL" }); return;
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    res.status(400).json({ error: "Only http/https URLs are supported" }); return;
  }

  try {
    const { stdout } = await execFileAsync(YTDLP_BIN, [
      "--dump-single-json",
      "--no-playlist",
      "--format", "best[ext=mp4]/best",
      "--socket-timeout", "15",
      pageUrl,
    ], { timeout: 30_000 });

    type YtDlpInfo = {
      title?: string;
      url?: string;
      protocol?: string;
      ext?: string;
      requested_downloads?: { url: string; protocol?: string; ext?: string }[];
      formats?: { url: string; ext?: string; protocol?: string }[];
    };
    const info = JSON.parse(stdout) as YtDlpInfo;
    const title = info.title ?? "Video";

    const bestDownload = info.requested_downloads?.[0];
    const cdnUrl =
      info.url ??
      bestDownload?.url ??
      info.formats?.slice(-1)[0]?.url ??
      "";

    if (!cdnUrl || !cdnUrl.startsWith("http")) {
      res.status(422).json({ error: "Could not extract a playable URL from that page." });
      return;
    }

    // Detect HLS: check URL extension, protocol field, or ext field
    const protocol = info.protocol ?? bestDownload?.protocol ?? "";
    const ext = info.ext ?? bestDownload?.ext ?? "";
    const isHls =
      cdnUrl.includes(".m3u8") ||
      protocol.includes("m3u8") ||
      ext === "m3u8";

    // Derive the base URL for resolving relative segment paths in the manifest
    const hlsBaseUrl = isHls
      ? cdnUrl.substring(0, cdnUrl.lastIndexOf("/") + 1)
      : undefined;

    // Record which CDN hostname is legitimate for this token so that the
    // sub-manifest and segment helpers can reject attacker-supplied URLs that
    // point at a different host (SSRF mitigation).
    const allowedHostname = new URL(cdnUrl).hostname;

    const token = crypto.randomUUID();
    tokenStore.set(token, {
      userId: auth.userId,
      cdnUrl,
      allowedHostname,
      expiresAt: Date.now() + TOKEN_TTL_MS,
      isHls,
      hlsBaseUrl,
    });
    res.json({ token, title, cdnUrl, isHls });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("403") || msg.includes("Forbidden")) {
      res.status(422).json({ error: "This site blocked the URL resolver. Download the video and load it as a file instead." });
    } else if (msg.includes("Unsupported URL") || msg.includes("No video formats found")) {
      res.status(422).json({ error: "This site isn't supported by the URL resolver." });
    } else {
      res.status(422).json({ error: "Could not extract a playable URL. Try a direct video file link or load a file instead." });
    }
  }
});

// ── GET /api/video/stream/:token ──────────────────────────────────────────────
router.get("/video/stream/:token", async (req: Request, res: Response) => {
  const entry = tokenStore.get(String(req.params.token));
  if (!entry || entry.expiresAt <= Date.now()) {
    res.status(404).json({ error: "Stream token not found or expired — re-resolve the URL." });
    return;
  }

  if (!verifyTokenOwner(req, res, entry)) return;

  proxyUpstream(entry.cdnUrl, req, res);
});

// ── Manifest rewriting helpers ─────────────────────────────────────────────────

/**
 * Rewrite a media (non-master) HLS playlist: segment URIs and URI= attributes
 * all get routed through our segment proxy.
 */
function rewriteMediaPlaylist(
  text: string,
  base: string,
  token: string,
  req: Request,
): string {
  return text
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();

      // Rewrite URI="..." attributes inside tags (e.g. EXT-X-KEY, EXT-X-MAP)
      const uriTagRewritten = trimmed.replace(/URI="([^"]+)"/g, (_match, uri: string) => {
        const abs = uri.startsWith("http") ? uri : base + uri;
        return `URI="${buildSegmentProxyUrl(req, token, abs)}"`;
      });

      if (uriTagRewritten !== trimmed) return uriTagRewritten;

      // Skip comment/tag lines (start with #) and empty lines
      if (trimmed === "" || trimmed.startsWith("#")) return line;

      // It's a segment URI — rewrite to segment proxy URL
      const absUri = trimmed.startsWith("http") ? trimmed : base + trimmed;
      return buildSegmentProxyUrl(req, token, absUri);
    })
    .join("\n");
}

/**
 * Rewrite a master HLS playlist: variant playlist URIs are routed through
 * our sub-manifest proxy so their segments can also be proxied.
 * URI="..." attributes inside master tags (e.g. #EXT-X-MEDIA for alternate
 * audio/subtitle renditions) are also rewritten through the sub-manifest proxy.
 */
function rewriteMasterPlaylist(
  text: string,
  base: string,
  token: string,
  req: Request,
): string {
  return text
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();

      // Rewrite URI="..." attributes inside master tags (e.g. EXT-X-MEDIA)
      if (trimmed.startsWith("#")) {
        return trimmed.replace(/URI="([^"]+)"/g, (_match, uri: string) => {
          const abs = uri.startsWith("http") ? uri : base + uri;
          return `URI="${buildSubManifestProxyUrl(req, token, abs)}"`;
        });
      }

      // Skip empty lines
      if (trimmed === "") return line;

      // It's a variant playlist URI — route through sub-manifest proxy
      const absUri = trimmed.startsWith("http") ? trimmed : base + trimmed;
      return buildSubManifestProxyUrl(req, token, absUri);
    })
    .join("\n");
}

// ── GET /api/video/hls/:token/manifest.m3u8 ───────────────────────────────────
// Fetches the upstream HLS manifest, detects whether it is a master playlist
// (multi-bitrate) or a media playlist (single-level), rewrites URIs accordingly,
// and returns it with proper content-type and CORS headers.
router.get("/video/hls/:token/manifest.m3u8", async (req: Request, res: Response) => {
  const entry = tokenStore.get(String(req.params.token));
  if (!entry || entry.expiresAt <= Date.now()) {
    res.status(404).json({ error: "Stream token not found or expired — re-resolve the URL." });
    return;
  }

  if (!verifyTokenOwner(req, res, entry)) return;

  if (!entry.isHls) {
    res.status(400).json({ error: "Token does not refer to an HLS stream." });
    return;
  }

  try {
    const manifestText = await fetchText(entry.cdnUrl);
    const base = entry.hlsBaseUrl ?? entry.cdnUrl.substring(0, entry.cdnUrl.lastIndexOf("/") + 1);
    const token = String(req.params.token);

    const isMaster = manifestText.includes("#EXT-X-STREAM-INF");
    const rewritten = isMaster
      ? rewriteMasterPlaylist(manifestText, base, token, req)
      : rewriteMediaPlaylist(manifestText, base, token, req);

    const origin = req.headers["origin"];
    res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
    if (origin) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
    }
    res.setHeader("Access-Control-Allow-Headers", "Range, Authorization");
    res.setHeader("Cache-Control", "no-cache");
    res.send(rewritten);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(502).json({ error: "Failed to fetch HLS manifest: " + msg });
  }
});

function buildSegmentProxyUrl(req: Request, token: string, segmentUrl: string): string {
  // Build an absolute URL pointing at our own segment proxy route.
  // We use the Host header so this works both in dev (via the Replit proxy) and production.
  const proto = req.headers["x-forwarded-proto"] ?? "https";
  const host = req.headers["x-forwarded-host"] ?? req.headers.host ?? "localhost";
  const base = `${proto}://${host}`;
  return `${base}/api/video/hls/${token}/segment?url=${encodeURIComponent(segmentUrl)}`;
}

function buildSubManifestProxyUrl(req: Request, token: string, playlistUrl: string): string {
  const proto = req.headers["x-forwarded-proto"] ?? "https";
  const host = req.headers["x-forwarded-host"] ?? req.headers.host ?? "localhost";
  const base = `${proto}://${host}`;
  return `${base}/api/video/hls/${token}/sub-manifest?url=${encodeURIComponent(playlistUrl)}`;
}

// ── Sub-manifest cache ────────────────────────────────────────────────────────
// Keeps the raw (pre-rewrite) playlist text for a short TTL so that hls.js
// polling several times per second does not hammer the upstream CDN.
const SUB_MANIFEST_CACHE_TTL_MS = 2_000;

interface SubManifestCacheEntry {
  text: string;
  expiresAt: number;
}
const subManifestCache = new Map<string, SubManifestCacheEntry>();

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of subManifestCache) if (v.expiresAt <= now) subManifestCache.delete(k);
}, SUB_MANIFEST_CACHE_TTL_MS).unref();

async function fetchTextCached(url: string): Promise<string> {
  const now = Date.now();
  const cached = subManifestCache.get(url);
  if (cached && cached.expiresAt > now) return cached.text;
  const text = await fetchText(url);
  subManifestCache.set(url, { text, expiresAt: now + SUB_MANIFEST_CACHE_TTL_MS });
  return text;
}

// ── GET /api/video/hls/:token/sub-manifest ────────────────────────────────────
// Fetches a variant (sub) playlist from a multi-bitrate master, rewrites its
// segment URIs through our segment proxy, and returns it as a media playlist.
router.get("/video/hls/:token/sub-manifest", async (req: Request, res: Response) => {
  const entry = tokenStore.get(String(req.params.token));
  if (!entry || entry.expiresAt <= Date.now()) {
    res.status(404).json({ error: "Stream token not found or expired — re-resolve the URL." });
    return;
  }

  if (!verifyTokenOwner(req, res, entry)) return;

  if (!entry.isHls) {
    res.status(400).json({ error: "Token does not refer to an HLS stream." });
    return;
  }

  const playlistUrl = (req.query.url as string | undefined)?.trim();
  if (!playlistUrl) {
    res.status(400).json({ error: "Missing playlist url parameter." });
    return;
  }

  // SSRF guard: only allow requests to the same CDN hostname that was
  // recorded when the token was minted.  This prevents an authenticated user
  // from using their token as a general-purpose server-side proxy against
  // internal or arbitrary external hosts.
  if (!isHostAllowed(playlistUrl, entry.allowedHostname)) {
    res.status(403).json({ error: "Playlist URL host is not permitted for this token." });
    return;
  }

  try {
    const playlistText = await fetchTextCached(playlistUrl);
    const base = playlistUrl.substring(0, playlistUrl.lastIndexOf("/") + 1);
    const token = String(req.params.token);

    const rewritten = rewriteMediaPlaylist(playlistText, base, token, req);

    const origin = req.headers["origin"];
    res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
    if (origin) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
    }
    res.setHeader("Access-Control-Allow-Headers", "Range, Authorization");
    res.setHeader("Cache-Control", "no-cache");
    res.send(rewritten);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(502).json({ error: "Failed to fetch sub-manifest: " + msg });
  }
});

// ── GET /api/video/hls/:token/segment ────────────────────────────────────────
// Proxies an individual HLS segment (.ts, .aac, etc.) with CORS headers so the
// video element stays CORS-clean for canvas frame-capture (Visual Trigger).
router.get("/video/hls/:token/segment", async (req: Request, res: Response) => {
  const entry = tokenStore.get(String(req.params.token));
  if (!entry || entry.expiresAt <= Date.now()) {
    res.status(404).json({ error: "Stream token not found or expired — re-resolve the URL." });
    return;
  }

  if (!verifyTokenOwner(req, res, entry)) return;

  if (!entry.isHls) {
    res.status(400).json({ error: "Token does not refer to an HLS stream." });
    return;
  }

  const segmentUrl = (req.query.url as string | undefined)?.trim();
  if (!segmentUrl) {
    res.status(400).json({ error: "Missing segment url parameter." });
    return;
  }

  // SSRF guard: only allow fetching segments from the same CDN hostname that
  // was resolved when the token was minted.
  if (!isHostAllowed(segmentUrl, entry.allowedHostname)) {
    res.status(403).json({ error: "Segment URL host is not permitted for this token." });
    return;
  }

  proxyUpstream(segmentUrl, req, res);
});

export default router;
