import { Router, type Request, type Response } from "express";
import { getAuth, clerkClient } from "@clerk/express";
import { pool } from "../lib/db";
import { logger } from "../lib/logger";

const router = Router();

/**
 * Retry an async operation up to `maxAttempts` times with exponential backoff.
 * Only retries on transient-looking errors (network / 5xx); rethrows immediately
 * on non-retryable errors so callers can distinguish them.
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  {
    maxAttempts = 3,
    baseDelayMs = 200,
    label = "operation",
  }: { maxAttempts?: number; baseDelayMs?: number; label?: string } = {},
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      lastErr = err;
      const isRetryable = isTransientError(err);
      if (!isRetryable || attempt === maxAttempts) {
        throw err;
      }
      const delayMs = baseDelayMs * 2 ** (attempt - 1);
      logger.warn({ err, attempt, label }, `${label} failed (attempt ${attempt}/${maxAttempts}), retrying in ${delayMs}ms`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw lastErr;
}

function isTransientError(err: unknown): boolean {
  if (err == null || typeof err !== "object") return true;
  const e = err as Record<string, unknown>;
  // Clerk SDK surfaces HTTP status on .status or .statusCode
  const status = (e.status ?? e.statusCode) as number | undefined;
  if (typeof status === "number") {
    // 4xx errors (except 429 rate-limit) are not transient
    return status === 429 || status >= 500;
  }
  // Network-level errors (no status) are assumed transient
  return true;
}

const USERNAME_RE = /^[a-zA-Z0-9_-]+$/;

function validateUsername(username: unknown): string | null {
  if (typeof username !== "string") return "Username is required.";
  if (username.length < 5) return "Username must be at least 5 characters.";
  if (username.length > 32) return "Username must be 32 characters or fewer.";
  if (!USERNAME_RE.test(username))
    return "Username may only contain letters, numbers, hyphens, and underscores.";
  return null;
}

/**
 * GET /api/users/check-username?username=
 * Returns { available: boolean }
 */
router.get("/users/check-username", async (req: Request, res: Response) => {
  const { username } = req.query as { username?: string };
  const validationError = validateUsername(username);
  if (validationError) {
    res.status(400).json({ error: validationError });
    return;
  }

  try {
    // If the requesting user already has this username set on their Clerk
    // account (partial-onboard recovery: Clerk write succeeded but DB insert
    // failed), treat it as available so the form can be re-submitted cleanly.
    const auth = getAuth(req);
    if (auth.userId) {
      const clerkUser = await clerkClient.users.getUser(auth.userId);
      if (clerkUser.username === username) {
        res.json({ available: true });
        return;
      }
    }

    const { rows } = await pool.query(
      `SELECT 1 FROM users WHERE username = $1 LIMIT 1`,
      [username],
    );
    res.json({ available: rows.length === 0 });
  } catch (err) {
    logger.error({ err }, "Failed to check username availability");
    res.status(500).json({ error: "Failed to check username availability." });
  }
});

/**
 * GET /api/users/me
 * Returns the signed-in user's profile from the DB: { username, plan }.
 * Returns 404 if the user has not yet completed onboarding.
 */
router.get("/users/me", async (req: Request, res: Response) => {
  const auth = getAuth(req);
  if (!auth.userId) {
    res.status(401).json({ error: "Not authenticated." });
    return;
  }
  try {
    const { rows } = await pool.query<{ username: string; plan: string }>(
      `SELECT username, plan FROM users WHERE clerk_id = $1 LIMIT 1`,
      [auth.userId],
    );
    if (rows.length === 0) {
      res.status(404).json({ error: "User not found. Complete onboarding first." });
      return;
    }
    res.json({ username: rows[0].username, plan: rows[0].plan });
  } catch (err) {
    logger.error({ err }, "Failed to fetch user profile");
    res.status(500).json({ error: "Failed to fetch profile." });
  }
});

/**
 * POST /api/users/onboard
 * Body: { username: string }
 * Requires a valid Clerk session.
 */
router.post("/users/onboard", async (req: Request, res: Response) => {
  const auth = getAuth(req);
  if (!auth.userId) {
    res.status(401).json({ error: "Not authenticated." });
    return;
  }

  const { username, ageVerified } = req.body as { username?: unknown; ageVerified?: unknown };

  if (ageVerified !== true) {
    res.status(400).json({ error: "Age verification is required." });
    return;
  }

  const validationError = validateUsername(username);
  if (validationError) {
    res.status(400).json({ error: validationError });
    return;
  }

  const usernameStr = username as string;

  try {
    // Check if this Clerk user already has a DB row (partial-onboarding recovery).
    const { rows: existingUser } = await pool.query<{ username: string }>(
      `SELECT username FROM users WHERE clerk_id = $1 LIMIT 1`,
      [auth.userId],
    );

    if (existingUser.length > 0) {
      // The DB row exists but the onboarded flag was never stamped (or the
      // client is retrying). Only accept the exact same username to prevent
      // any accidental hijacking.
      if (existingUser[0].username !== usernameStr) {
        res.status(409).json({ error: "A different username is already registered to your account." });
        return;
      }
      // Idempotent recovery: re-stamp the Clerk metadata and return success.
      try {
        await withRetry(
          () =>
            clerkClient.users.updateUserMetadata(auth.userId, {
              publicMetadata: { onboarded: true },
            }),
          { label: "updateUserMetadata (recovery)", maxAttempts: 3, baseDelayMs: 200 },
        );
      } catch (clerkErr) {
        logger.error(
          { err: clerkErr, userId: auth.userId, username: usernameStr },
          "Clerk metadata write failed after all retries (recovery path)",
        );
        res.status(503).json({ error: "Onboarding DB row exists but Clerk metadata update failed. Please try again." });
        return;
      }
      res.json({ message: "Onboarding complete.", username: usernameStr });
      return;
    }

    // New user path: ensure the username is not taken by anyone else.
    const { rows: taken } = await pool.query(
      `SELECT 1 FROM users WHERE username = $1 LIMIT 1`,
      [usernameStr],
    );
    if (taken.length > 0) {
      res.status(409).json({ error: "Username is already taken." });
      return;
    }

    // Insert user row
    try {
      await pool.query(
        `INSERT INTO users (clerk_id, username, age_verified, plan) VALUES ($1, $2, $3, 'free')`,
        [auth.userId, usernameStr, ageVerified],
      );
    } catch (err: unknown) {
      // PostgreSQL unique-constraint violation code
      if (
        typeof err === "object" &&
        err !== null &&
        "code" in err &&
        (err as { code: string }).code === "23505"
      ) {
        res.status(409).json({ error: "Username is already taken." });
        return;
      }
      throw err;
    }

    // Mark onboarded in Clerk public metadata
    try {
      await withRetry(
        () =>
          clerkClient.users.updateUserMetadata(auth.userId, {
            publicMetadata: { onboarded: true },
          }),
        { label: "updateUserMetadata (new user)", maxAttempts: 3, baseDelayMs: 200 },
      );
    } catch (clerkErr) {
      logger.error(
        { err: clerkErr, userId: auth.userId, username: usernameStr },
        "Clerk metadata write failed after all retries (new user path)",
      );
      // DB row was already inserted — client can retry and hit the recovery path.
      res.status(503).json({ error: "Account created but Clerk metadata update failed. Please try again to complete setup." });
      return;
    }

    res.json({ message: "Onboarding complete.", username: usernameStr });
  } catch (err) {
    logger.error({ err }, "Failed to complete onboarding");
    res.status(500).json({ error: "Failed to complete onboarding." });
  }
});

export default router;
