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

// ─── Text sanitizer ────────────────────────────────────────────────────────

/**
 * Strip HTML/XML tags and control characters from a user-supplied name/title,
 * then trim surrounding whitespace.  Returns the cleaned string (may be empty
 * — callers should reject empty results).
 *
 * Kept free of DOM APIs so it can run in both the browser and Node.
 */
export function sanitizeName(raw: string): string {
  return raw
    .replace(/<[^>]*>/g, " ")             // strip HTML/XML tags
    .replace(/[\x00-\x1F\x7F]/g, " ")    // strip control characters
    .replace(/\s+/g, " ")                 // collapse whitespace
    .trim();
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

// ─── Library / community tag vocabulary ────────────────────────────────────

/**
 * Predefined tag vocabulary attached to entries in `private_library` and
 * `community_scripts`. This is the SINGLE source of truth — the API server
 * validates writes against this list, and the frontend renders the picker
 * from it. To finalise the vocabulary, edit this array (and only this
 * array) — both sides will update together.
 *
 * NOTE: this is a starter vocabulary; the user has explicitly deferred
 * settling on the final list. Keep it short and orthogonal so the picker
 * stays usable.
 */
export const LIBRARY_TAGS = [
  "Soft",
  "Hardcore",
  "Romantic",
  "Solo",
  "POV",
  "Vanilla",
  "BDSM",
  "Edging",
  "Quickie",
  "Long-form",
  "Audio-only",
  "Music-sync",
] as const;

export type LibraryTag = typeof LIBRARY_TAGS[number];

/** Lower-cased lookup for case-insensitive validation. */
const TAG_LOOKUP: Map<string, LibraryTag> = new Map(
  LIBRARY_TAGS.map((t) => [t.toLowerCase(), t]),
);

/** Maximum number of tags that can be attached to a single entry. */
export const MAX_TAGS_PER_ENTRY = 5;

/** Maximum number of tag filters that can be stacked in a search query. */
export const MAX_TAG_FILTERS = 3;

export interface TagsValidationError {
  code:
    | "NOT_AN_ARRAY"
    | "TOO_MANY_TAGS"
    | "DUPLICATE_TAG"
    | "UNKNOWN_TAG";
  message: string;
}

/**
 * Validate and canonicalise a user-supplied tag array for *writes*
 * (POST/PATCH on library + community entries).
 *
 * - Trims and case-insensitively maps each input to its canonical name.
 * - Drops empty strings.
 * - Rejects unknown tags, duplicates, and arrays longer than
 *   `MAX_TAGS_PER_ENTRY`.
 *
 * Returns `{ tags }` on success or `{ error }` on failure. Server is the
 * source of truth — never write client-supplied strings directly.
 */
export function validateTagsForWrite(
  raw: unknown,
): { tags: LibraryTag[] } | { error: TagsValidationError } {
  if (raw === undefined || raw === null) return { tags: [] };
  if (!Array.isArray(raw)) {
    return { error: { code: "NOT_AN_ARRAY", message: "tags must be an array of strings." } };
  }
  const seen = new Set<LibraryTag>();
  const out: LibraryTag[] = [];
  for (const item of raw) {
    if (typeof item !== "string") {
      return { error: { code: "UNKNOWN_TAG", message: "tags must be strings." } };
    }
    const trimmed = item.trim();
    if (!trimmed) continue;
    const canon = TAG_LOOKUP.get(trimmed.toLowerCase());
    if (!canon) {
      return {
        error: {
          code: "UNKNOWN_TAG",
          message: `Unknown tag "${trimmed}". Allowed: ${LIBRARY_TAGS.join(", ")}.`,
        },
      };
    }
    if (seen.has(canon)) {
      return { error: { code: "DUPLICATE_TAG", message: `Duplicate tag "${canon}".` } };
    }
    seen.add(canon);
    out.push(canon);
  }
  if (out.length > MAX_TAGS_PER_ENTRY) {
    return {
      error: {
        code: "TOO_MANY_TAGS",
        message: `At most ${MAX_TAGS_PER_ENTRY} tags per entry.`,
      },
    };
  }
  return { tags: out };
}

/**
 * Parse + sanitise a `?tags=foo,bar,baz` query string for *reads*.
 *
 * - Splits on comma.
 * - Maps each piece to its canonical name (case-insensitive).
 * - Silently drops unknown tags / blanks (so a stale URL doesn't 400).
 * - Caps at `MAX_TAG_FILTERS` to bound query cost.
 * - De-duplicates while preserving first-seen order.
 */
export function parseTagsFilter(raw: unknown): LibraryTag[] {
  if (typeof raw !== "string" || !raw.trim()) return [];
  const seen = new Set<LibraryTag>();
  const out: LibraryTag[] = [];
  for (const piece of raw.split(",")) {
    if (out.length >= MAX_TAG_FILTERS) break;
    const trimmed = piece.trim();
    if (!trimmed) continue;
    const canon = TAG_LOOKUP.get(trimmed.toLowerCase());
    if (!canon || seen.has(canon)) continue;
    seen.add(canon);
    out.push(canon);
  }
  return out;
}

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

  // URL parses bracketed IPv6 hostnames (e.g. "[::1]") with brackets attached.
  // Strip them so the PRIVATE_IP_RE patterns for ::1 / fc00: / fd..: actually match.
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
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
