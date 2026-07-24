import https from "https";
import http from "http";
import dns from "dns";
import net from "net";
import { gcsClient } from "./hapticaiStorage";
import { pool } from "./db";
import { logger } from "./logger";

const VIDEO_MAX_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB
const MAX_REDIRECTS = 5;
export const MEDIA_KEY_PREFIX = "media/community";

// ─── Token store for unauthenticated streaming ────────────────────────────────
// Browser <video> elements cannot attach Bearer tokens, so we issue short-lived
// opaque tokens (similar to /api/video/stream/:token in video.ts) that the
// player uses to fetch cached video bytes without additional auth.

const CACHED_VIDEO_TOKEN_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

interface CachedVideoToken {
  userId: string;
  scriptId: number;
  storageKey: string;
  expiresAt: number;
}

const tokenStore = new Map<string, CachedVideoToken>();

setInterval(() => {
  const now = Date.now();
  for (const [t, e] of tokenStore) if (e.expiresAt <= now) tokenStore.delete(t);
}, 30 * 60 * 1000).unref();

/**
 * Mint a short-lived streaming token for a cached community video.
 * The token is tied to the requesting userId and expires in 6 hours.
 */
export function mintCachedVideoToken(userId: string, scriptId: number, storageKey: string): string {
  const token = crypto.randomUUID();
  tokenStore.set(token, {
    userId,
    scriptId,
    storageKey,
    expiresAt: Date.now() + CACHED_VIDEO_TOKEN_TTL_MS,
  });
  return token;
}

/**
 * Look up a token. Returns undefined if missing or expired.
 */
export function lookupCachedVideoToken(token: string): CachedVideoToken | undefined {
  const entry = tokenStore.get(token);
  if (!entry || entry.expiresAt <= Date.now()) return undefined;
  return entry;
}

// ─── Storage helpers ──────────────────────────────────────────────────────────

function getBucketName(): string {
  const explicit = process.env.HAPTICAI_STORAGE_BUCKET?.trim();
  if (explicit) return explicit;
  const dir = process.env.PRIVATE_OBJECT_DIR?.trim() ?? "";
  if (dir) {
    const first = dir.replace(/^\//, "").split("/")[0];
    if (first) return first;
  }
  throw new Error("Storage bucket not configured. Set HAPTICAI_STORAGE_BUCKET (or PRIVATE_OBJECT_DIR).");
}

export function storageKeyForScript(scriptId: number): string {
  return `${MEDIA_KEY_PREFIX}/${scriptId}`;
}

// ─── SSRF guard ───────────────────────────────────────────────────────────────

async function assertHostIsPublic(hostname: string): Promise<void> {
  let addresses: string[];
  try {
    const result = await dns.promises.lookup(hostname, { all: true });
    addresses = result.map((r) => r.address);
  } catch {
    throw new Error(`Could not resolve hostname: ${hostname}`);
  }
  for (const addr of addresses) {
    if (isPrivateIp(addr)) {
      throw new Error(`Hostname ${hostname} resolves to a private IP address (${addr})`);
    }
  }
}

function isPrivateIp(ip: string): boolean {
  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    if (lower === "::1") return true;
    if (lower.startsWith("fc") || lower.startsWith("fd")) return true;
    if (lower.startsWith("fe80")) return true;
    return false;
  }
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4) return false;
  const [a, b] = parts;
  if (a === 127) return true;
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;
  if (a === 0) return true;
  return false;
}

// ─── Download helper (redirect-following) ────────────────────────────────────

function fetchStream(
  url: string,
  redirectsLeft = MAX_REDIRECTS,
): Promise<{ stream: NodeJS.ReadableStream; contentType: string }> {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https") ? https : http;
    const reqHeaders = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      "Accept": "*/*",
    };
    const req = lib.request(url, { headers: reqHeaders, method: "GET" }, (res) => {
      const status = res.statusCode ?? 0;

      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume();
        if (redirectsLeft <= 0) { reject(new Error("Too many redirects")); return; }
        let redirectUrl = res.headers.location;
        if (!redirectUrl.startsWith("http")) {
          try { redirectUrl = new URL(redirectUrl, url).toString(); }
          catch { reject(new Error(`Invalid redirect URL: ${redirectUrl}`)); return; }
        }
        let redirectHost: string;
        try { redirectHost = new URL(redirectUrl).hostname; }
        catch { reject(new Error(`Invalid redirect URL: ${redirectUrl}`)); return; }
        assertHostIsPublic(redirectHost)
          .then(() => fetchStream(redirectUrl, redirectsLeft - 1))
          .then(resolve)
          .catch(reject);
        return;
      }

      if (status >= 400) {
        reject(new Error(`Upstream returned HTTP ${status}`));
        res.resume();
        return;
      }

      const contentType = (res.headers["content-type"] as string) ?? "application/octet-stream";
      resolve({ stream: res, contentType });
    });
    req.on("error", reject);
    req.end();
  });
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Download the video at `videoUrl` and stream it into GCS under the
 * `media/community/<scriptId>` key.
 *
 * Safety: DNS/SSRF check, redirect following, 2 GB cap, race-safe DB update.
 * Fire-and-forget after INSERT.
 */
export async function cacheVideoInBackground(scriptId: number, videoUrl: string): Promise<void> {
  try {
    const parsed = new URL(videoUrl);
    await assertHostIsPublic(parsed.hostname);

    const { stream, contentType } = await fetchStream(videoUrl);
    const bucketName = getBucketName();
    const storageKey = storageKeyForScript(scriptId);
    const bucket = gcsClient.bucket(bucketName);
    const file = bucket.file(storageKey);

    let bytesWritten = 0;
    let aborted = false;

    await new Promise<void>((resolve, reject) => {
      const writeStream = file.createWriteStream({ metadata: { contentType }, resumable: false });
      stream.on("data", (chunk: Buffer) => {
        bytesWritten += chunk.length;
        if (bytesWritten > VIDEO_MAX_BYTES && !aborted) {
          aborted = true;
          writeStream.destroy(new Error("Video exceeds 2 GB limit"));
          (stream as NodeJS.ReadableStream & { destroy?: () => void }).destroy?.();
        }
      });
      stream.on("error", reject);
      writeStream.on("error", reject);
      writeStream.on("finish", resolve);
      stream.pipe(writeStream);
    });

    // Race guard: if the row was deleted while we were uploading, clean up.
    const { rows } = await pool.query(`SELECT id FROM community_scripts WHERE id = $1`, [scriptId]);
    if (!rows.length) {
      logger.warn({ scriptId, storageKey }, "Script deleted before cache write; removing orphaned GCS object");
      await file.delete().catch(() => undefined);
      return;
    }

    // Store the GCS object key (not a public URL). Access is controlled via
    // the short-lived token endpoint GET /api/community/cached-video/:token.
    await pool.query(
      `UPDATE community_scripts SET cache_status = 'cached', cached_video_url = $1 WHERE id = $2`,
      [storageKey, scriptId],
    );
    logger.info({ scriptId, storageKey, bytes: bytesWritten }, "Community video cached successfully");
  } catch (err) {
    logger.warn({ scriptId, videoUrl, err }, "Failed to cache community video");
    await pool.query(
      `UPDATE community_scripts SET cache_status = 'failed' WHERE id = $1`,
      [scriptId],
    ).catch(() => undefined);
  }
}

/**
 * Stream the cached GCS object for a community script to an Express response.
 * Supports byte-range requests for video seeking.
 * Returns false if the GCS object does not exist.
 */
export async function streamCachedVideo(
  storageKey: string,
  rangeHeader: string | undefined,
  res: import("express").Response,
): Promise<boolean> {
  const bucketName = getBucketName();
  const file = gcsClient.bucket(bucketName).file(storageKey);

  const [exists] = await file.exists();
  if (!exists) return false;

  const [metadata] = await file.getMetadata();
  const contentType = (metadata.contentType as string) ?? "application/octet-stream";
  const totalBytes = Number(metadata.size ?? 0);

  if (rangeHeader && totalBytes > 0) {
    const match = rangeHeader.match(/^bytes=(\d*)-(\d*)$/);
    if (match) {
      const start = match[1] ? parseInt(match[1], 10) : 0;
      const end = match[2] ? parseInt(match[2], 10) : totalBytes - 1;
      const chunkSize = end - start + 1;

      res.status(206);
      res.setHeader("Content-Type", contentType);
      res.setHeader("Content-Range", `bytes ${start}-${end}/${totalBytes}`);
      res.setHeader("Content-Length", chunkSize);
      res.setHeader("Accept-Ranges", "bytes");
      res.setHeader("Cache-Control", "public, max-age=3600");

      const readStream = file.createReadStream({ start, end });
      readStream.on("error", () => { if (!res.headersSent) res.status(500).end(); });
      readStream.pipe(res);
      return true;
    }
  }

  res.status(200);
  res.setHeader("Content-Type", contentType);
  res.setHeader("Content-Length", totalBytes);
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Cache-Control", "public, max-age=3600");

  const readStream = file.createReadStream({});
  readStream.on("error", () => { if (!res.headersSent) res.status(500).end(); });
  readStream.pipe(res);
  return true;
}

/**
 * Delete the cached GCS object for a community script (best-effort).
 */
export async function deleteCachedVideo(scriptId: number): Promise<void> {
  try {
    const bucketName = getBucketName();
    const storageKey = storageKeyForScript(scriptId);
    const file = gcsClient.bucket(bucketName).file(storageKey);
    const [exists] = await file.exists();
    if (exists) {
      await file.delete();
      logger.info({ scriptId, storageKey }, "Deleted cached community video");
    }
  } catch (err) {
    logger.warn({ scriptId, err }, "Could not delete cached community video — continuing");
  }
}
