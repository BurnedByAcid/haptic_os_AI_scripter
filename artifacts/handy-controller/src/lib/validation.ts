/** Shared input validation utilities for HapticOS frontend. */

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
 * Validate a funscript File before parsing.
 * Returns null on success, or a structured error.
 */
export function validateFunscriptFile(
  file: File
): FunscriptValidationError | null {
  if (file.size > FUNSCRIPT_MAX_BYTES) {
    return {
      code: "TOO_LARGE",
      message: `File is too large (${(file.size / 1_048_576).toFixed(1)} MB). Maximum allowed is 50 MB.`,
    };
  }
  const lower = file.name.toLowerCase();
  if (!lower.endsWith(".funscript") && !lower.endsWith(".json")) {
    return {
      code: "WRONG_EXTENSION",
      message: "Only .funscript or .json files are accepted.",
    };
  }
  return null;
}

/**
 * Validate parsed funscript JSON.
 * Returns null on success, or a structured error.
 */
export function validateFunscriptJson(
  json: unknown
): FunscriptValidationError | null {
  if (typeof json !== "object" || json === null || Array.isArray(json)) {
    return { code: "INVALID_JSON", message: "Funscript must be a JSON object." };
  }
  const obj = json as Record<string, unknown>;
  if (!Array.isArray(obj.actions)) {
    return { code: "MISSING_ACTIONS", message: 'Funscript must have an "actions" array.' };
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

/**
 * Full file + JSON validation in one call.
 * Reads the file text, parses, and validates.
 * Returns { script } on success or throws with a user-facing message.
 */
export async function validateAndParseFunscriptFile(
  file: File
): Promise<{ actions: { at: number; pos: number }[] }> {
  const fileErr = validateFunscriptFile(file);
  if (fileErr) throw new Error(fileErr.message);

  let text: string;
  try {
    text = await file.text();
  } catch {
    throw new Error("Could not read the file. It may be corrupted or inaccessible.");
  }

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error("The file is not valid JSON. Is it actually a funscript?");
  }

  const jsonErr = validateFunscriptJson(json);
  if (jsonErr) throw new Error(jsonErr.message);

  return json as { actions: { at: number; pos: number }[] };
}

// ─── URL safety validation ─────────────────────────────────────────────────

/** Hostnames explicitly allowed for video embeds / library URLs. */
const ALLOWED_VIDEO_HOSTS = new Set([
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
const PRIVATE_IP_RE =
  /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.0\.0\.0|::1|fc00:|fd[0-9a-f]{2}:)/i;

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
 *  - Either a known embed platform host OR a direct video file URL (.mp4/.webm/.ogg/.mov)
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
  const isDirectVideo = /\.(mp4|webm|ogg|mov)(\?.*)?$/i.test(url.pathname);

  if (!isKnownHost && !isDirectVideo) {
    return {
      code: "DISALLOWED_HOST",
      message:
        "URL must be from YouTube, Pornhub, xVideos, xHamster, RedTube, Vimeo, or a direct .mp4/.webm video link.",
    };
  }

  return null;
}
