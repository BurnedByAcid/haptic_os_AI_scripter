import rateLimit, { type RateLimitRequestHandler } from "express-rate-limit";
import type { Request } from "express";

function intFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function clientKey(req: Request): string {
  const auth = (req as Request & { auth?: () => { userId?: string | null } }).auth;
  try {
    const userId = typeof auth === "function" ? auth()?.userId : undefined;
    if (userId) return `u:${userId}`;
  } catch {
    /* ignore */
  }
  return `ip:${req.ip ?? "unknown"}`;
}

const SCRIPT_UPLOAD_WINDOW_MS = intFromEnv("RATE_LIMIT_SCRIPT_UPLOAD_WINDOW_MS", 60 * 60 * 1000);
const SCRIPT_UPLOAD_MAX = intFromEnv("RATE_LIMIT_SCRIPT_UPLOAD_MAX", 20);

const WRITE_WINDOW_MS = intFromEnv("RATE_LIMIT_WRITE_WINDOW_MS", 60 * 1000);
const WRITE_MAX = intFromEnv("RATE_LIMIT_WRITE_MAX", 60);

export const scriptUploadLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: SCRIPT_UPLOAD_WINDOW_MS,
  limit: SCRIPT_UPLOAD_MAX,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: clientKey,
  message: {
    error:
      "Too many script uploads. Please wait a bit before sharing more scripts.",
  },
});

export const writeLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: WRITE_WINDOW_MS,
  limit: WRITE_MAX,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: clientKey,
  message: {
    error: "Too many requests. Please slow down and try again shortly.",
  },
});
