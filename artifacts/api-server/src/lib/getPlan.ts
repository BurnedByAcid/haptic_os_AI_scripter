import { clerkClient } from "@clerk/express";
import { pool } from "./db";

/**
 * Returns the effective plan for a user.
 *
 * Strategy (in order):
 * 1. Query the `users` DB table. If the stored plan is anything other than
 *    "free", trust it — it was written by an explicit admin action.
 * 2. Fall back to Clerk publicMetadata.plan. This catches users (especially
 *    bootstrapped admins) whose Clerk metadata is authoritative but whose DB
 *    row has not yet been synced.
 * 3. Default to "free" if neither source has a meaningful value.
 *
 * Admin is a tier above subscriber — it satisfies every subscriber-gated
 * check. The SUBSCRIBER_PLANS sets in each route include "admin" explicitly.
 */
export async function getPlan(userId: string): Promise<string> {
  const { rows } = await pool.query<{ plan: string }>(
    `SELECT plan FROM users WHERE clerk_id = $1`,
    [userId],
  );
  const dbPlan = (rows[0]?.plan ?? "free").toLowerCase();

  if (dbPlan !== "free") return dbPlan;

  try {
    const user = await clerkClient.users.getUser(userId);
    const meta = user.publicMetadata as Record<string, unknown>;
    const clerkPlan = typeof meta?.plan === "string" ? meta.plan.toLowerCase() : "";
    if (clerkPlan && clerkPlan !== "free") return clerkPlan;
  } catch {
    // Clerk unavailable — fall back to DB value
  }

  return dbPlan;
}
