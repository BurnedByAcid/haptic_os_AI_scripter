import { Router, type Request, type Response } from "express";
import { getAuth, clerkClient } from "@clerk/express";
import { pool } from "../lib/db";
import { logger } from "../lib/logger";

const router = Router();

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

  const { username } = req.body as { username?: unknown };

  const validationError = validateUsername(username);
  if (validationError) {
    res.status(400).json({ error: validationError });
    return;
  }

  const usernameStr = username as string;

  try {
    // Check uniqueness
    const { rows: existing } = await pool.query(
      `SELECT 1 FROM users WHERE username = $1 LIMIT 1`,
      [usernameStr],
    );
    if (existing.length > 0) {
      res.status(409).json({ error: "Username is already taken." });
      return;
    }

    // Check if this clerk user already has a row (idempotent protection)
    const { rows: alreadyOnboarded } = await pool.query(
      `SELECT 1 FROM users WHERE clerk_id = $1 LIMIT 1`,
      [auth.userId],
    );
    if (alreadyOnboarded.length > 0) {
      res.status(409).json({ error: "User is already onboarded." });
      return;
    }

    // Insert user row
    try {
      await pool.query(
        `INSERT INTO users (clerk_id, username, age_verified, plan) VALUES ($1, $2, $3, 'free')`,
        [auth.userId, usernameStr, true],
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
    await clerkClient.users.updateUserMetadata(auth.userId, {
      publicMetadata: { onboarded: true },
    });

    res.json({ message: "Onboarding complete.", username: usernameStr });
  } catch (err) {
    logger.error({ err }, "Failed to complete onboarding");
    res.status(500).json({ error: "Failed to complete onboarding." });
  }
});

export default router;
