/**
 * Frontend validation entry point.
 *
 * The host-allowlist + URL/funscript-JSON rules live in the shared
 * `@workspace/validation` package so the API server applies the exact same
 * rules. This file only adds the browser-only helpers that depend on the DOM
 * `File` type, and re-exports the shared API for ergonomic imports.
 */

import {
  FUNSCRIPT_MAX_BYTES,
  validateFunscriptJson,
  type FunscriptValidationError,
} from "@workspace/validation";

export {
  ALLOWED_VIDEO_HOSTS,
  DIRECT_VIDEO_EXT_RE,
  FUNSCRIPT_MAX_BYTES,
  PRIVATE_IP_RE,
  sanitizeName,
  validateFunscriptJson,
  validateVideoUrl,
} from "@workspace/validation";
export type {
  FunscriptValidationError,
  UrlValidationError,
} from "@workspace/validation";

/**
 * Validate a funscript File before parsing.
 * Returns null on success, or a structured error.
 */
export function validateFunscriptFile(
  file: File,
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
 * Full file + JSON validation in one call.
 * Reads the file text, parses, and validates.
 * Returns the parsed funscript on success or throws with a user-facing message.
 */
export async function validateAndParseFunscriptFile(
  file: File,
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
