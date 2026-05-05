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
// Maps a short-lived UUID token → CDN URL. Avoids exposing the raw CDN URL to
// the client and gives the proxy endpoint a stable handle to look up.
interface TokenEntry { cdnUrl: string; expiresAt: number }
const tokenStore = new Map<string, TokenEntry>();
const TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

setInterval(() => {
  const now = Date.now();
  for (const [t, e] of tokenStore) if (e.expiresAt <= now) tokenStore.delete(t);
}, 10 * 60 * 1000).unref();

// ── GET /api/video/resolve ────────────────────────────────────────────────────
// Accepts any page URL, runs yt-dlp to extract a direct stream URL, stores it
// behind a token, and returns { token, title, cdnUrl }.
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
      requested_downloads?: { url: string }[];
      formats?: { url: string; ext?: string }[];
    };
    const info = JSON.parse(stdout) as YtDlpInfo;
    const title = info.title ?? "Video";
    const cdnUrl =
      info.url ??
      info.requested_downloads?.[0]?.url ??
      info.formats?.slice(-1)[0]?.url ??
      "";

    if (!cdnUrl || !cdnUrl.startsWith("http")) {
      res.status(422).json({ error: "Could not extract a playable URL from that page." });
      return;
    }

    const token = crypto.randomUUID();
    tokenStore.set(token, { cdnUrl, expiresAt: Date.now() + TOKEN_TTL_MS });
    res.json({ token, title, cdnUrl });
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
// Proxies the resolved CDN video through our server with CORS headers and full
// Range request passthrough so <video crossOrigin="anonymous"> + canvas capture
// (needed for Visual Trigger frame analysis) works without CORS tainting.
router.get("/video/stream/:token", async (req: Request, res: Response) => {
  const entry = tokenStore.get(String(req.params.token));
  if (!entry || entry.expiresAt <= Date.now()) {
    res.status(404).json({ error: "Stream token not found or expired — re-resolve the URL." });
    return;
  }

  const upstreamHeaders: Record<string, string> = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept": "*/*",
  };
  if (req.headers["range"]) upstreamHeaders["Range"] = req.headers["range"] as string;

  const cdnUrl = entry.cdnUrl;
  const lib = cdnUrl.startsWith("https") ? https : http;

  const upstream = lib.request(cdnUrl, { headers: upstreamHeaders, method: "GET" }, (uRes) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Range");
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
});

export default router;
