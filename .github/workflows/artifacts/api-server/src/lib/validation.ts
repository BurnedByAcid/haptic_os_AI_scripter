import sanitizeHtml from "sanitize-html";
import {
  validateVideoUrl,
  validateFunscriptJson as validateFunscriptJsonShared,
} from "@workspace/validation";

export const FIELD_LIMITS = {
  title: 255,
  description: 2000,
  author_name: 100,
  tags: 500,
};

/** Strip all HTML tags and control characters from a string. */
export function sanitizeText(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return sanitizeHtml(raw, { allowedTags: [], allowedAttributes: {} })
    .replace(/[\x00-\x1F\x7F]/g, " ")
    .trim();
}

/**
 * Adapt the shared video-URL validator to the API's plain-string error format,
 * prefixing messages with `video_url ...` for backwards-compatible responses.
 */
export function validateUrl(raw: string): string | null {
  const err = validateVideoUrl(raw);
  if (!err) return null;
  switch (err.code) {
    case "INVALID_URL":
      return "video_url is not a valid URL.";
    case "NOT_HTTPS":
      return "video_url must use HTTPS.";
    case "PRIVATE_IP":
      return "video_url points to a private or local address.";
    case "DISALLOWED_HOST":
      return "video_url must be from an allowed platform (YouTube, Pornhub, xVideos, xHamster, RedTube, Vimeo) or a direct .mp4/.webm link.";
    default:
      return err.message;
  }
}

/**
 * Adapt the shared funscript validator to the API's plain-string error format,
 * prefixing messages with `script_json ...` for backwards-compatible responses.
 */
export function validateFunscriptJson(raw: unknown): string | null {
  const err = validateFunscriptJsonShared(raw);
  if (!err) return null;
  switch (err.code) {
    case "INVALID_JSON":
      return "script_json must be a JSON object.";
    case "MISSING_ACTIONS":
      return 'script_json must have an "actions" array.';
    case "INVALID_ACTION":
      return `script_json ${err.message}`;
    // TOO_LARGE / WRONG_EXTENSION only apply to file uploads, not JSON payloads.
    default:
      return err.message;
  }
}
