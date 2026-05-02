/**
 * Shared input-validation utilities for HapticOS.
 *
 * This package is the SINGLE source of truth for:
 *   - the list of allowed video-embed hostnames
 *   - the regex used to detect direct video file URLs (.mp4/.webm/.ogg/.mov)
 *   - the regex used to block private / loopback / link-local hosts
 *   - the funscript JSON shape validator
 *   - the funscript file-size limit
 *
 * It is consumed by both the web app (`@workspace/handy-controller`) and the
 * API server (`@workspace/api-server`). To add or remove a host, edit
 * `ALLOWED_VIDEO_HOSTS` below — both sides will pick up the change.
 *
 * IMPORTANT: keep this file free of DOM-only types (e.g. `File`) so it can be
 * imported by Node code as well as the browser. Browser-only helpers (such as
 * `validateFunscriptFile` / `validateAndParseFunscriptFile`) live in the web
 * artifact.
 */

// ─── Funscript validation ──────────────────────────────────────────────────

export const FUNSCRIPT_MAX_BYTES = 50 * 1024 * 1024; // 50 MB

export interface FunscriptValidationError {
  code:
    | "TOO_LARGE"
    | "WRONG_EXTENSION"
    | "INVALID_JSON"
    | "MISSING_ACTIONS"
    | "INVALID_ACTION";
  message: string;
}

/**
 * Validate parsed funscript JSON.
 * Returns null on success, or a structured error.
 */
export function validateFunscriptJson(
  json: unknown,
): FunscriptValidationError | null {
  if (typeof json !== "object" || json === null || Array.isArray(json)) {
    return {
      code: "INVALID_JSON",
      message: "Funscript must be a JSON object.",
    };
  }
  const obj = json as Record<string, unknown>;
  if (!Array.isArray(obj.actions)) {
    return {
      code: "MISSING_ACTIONS",
      message: 'Funscript must have an "actions" array.',
    };
  }
  for (let i = 0; i < obj.actions.length; i++) {
    const a = obj.actions[i] as Record<string, unknown>;
    if (
      typeof a !== "object" ||
      a === null ||
      typeof a.at !== "number" ||
      typeof a.pos !== "number" ||
      a.at < 0 ||
      a.pos < 0 ||
      a.pos > 100
    ) {
      return {
        code: "INVALID_ACTION",
        message: `actions[${i}]: each action must have numeric "at" (≥ 0) and "pos" (0–100).`,
      };
    }
  }
  return null;
}

// ─── URL safety validation ─────────────────────────────────────────────────

/** Hostnames explicitly allowed for video embeds / library URLs. */
export const ALLOWED_VIDEO_HOSTS: ReadonlySet<string> = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "youtu.be",
  "pornhub.com",
  "www.pornhub.com",
  "xvideos.com",
  "www.xvideos.com",
  "xhamster.com",
  "www.xhamster.com",
  "xhamster.desi",
  "redtube.com",
  "www.redtube.com",
  "vimeo.com",
  "www.vimeo.com",
  "player.vimeo.com",
]);

/** Private / loopback / link-local IP ranges to block. */
export const PRIVATE_IP_RE =
  /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.0\.0\.0|::1|fc00:|fd[0-9a-f]{2}:)/i;

/** Matches a URL pathname that ends in a directly-playable video extension. */
export const DIRECT_VIDEO_EXT_RE = /\.(mp4|webm|ogg|mov)(\?.*)?$/i;

export interface UrlValidationError {
  code: "INVALID_URL" | "NOT_HTTPS" | "PRIVATE_IP" | "DISALLOWED_HOST";
  message: string;
}

/**
 * Validate a user-supplied video URL.
 * Returns null on success, or a structured error.
 *
 * Allows:
 *  - https:// only (no http, javascript, data, etc.)
 *  - No private / local IP addresses
 *  - Either a known embed platform host OR a direct video file URL
 *    (.mp4/.webm/.ogg/.mov)
 */
export function validateVideoUrl(raw: string): UrlValidationError | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { code: "INVALID_URL", message: "That doesn't look like a valid URL." };
  }

  if (url.protocol !== "https:") {
    return {
      code: "NOT_HTTPS",
      message: "Only HTTPS URLs are accepted for safety.",
    };
  }

  const host = url.hostname.toLowerCase();
  if (PRIVATE_IP_RE.test(host)) {
    return {
      code: "PRIVATE_IP",
      message: "URLs pointing to local or private addresses are not allowed.",
    };
  }

  const isKnownHost = ALLOWED_VIDEO_HOSTS.has(host);
  const isDirectVideo = DIRECT_VIDEO_EXT_RE.test(url.pathname);

  if (!isKnownHost && !isDirectVideo) {
    return {
      code: "DISALLOWED_HOST",
      message:
        "URL must be from YouTube, Pornhub, xVideos, xHamster, RedTube, Vimeo, or a direct .mp4/.webm video link.",
    };
  }

  return null;
}
