import { Router, type IRouter, type Request, type Response } from "express";
import { getAuth, clerkClient } from "@clerk/express";

const router: IRouter = Router();

const VALID_PLANS = ["free", "pro", "subscriber", "admin"] as const;
type Plan = typeof VALID_PLANS[number];

/**
 * POST /api/admin/bootstrap
 *
 * One-time endpoint: promotes the calling authenticated user to "admin" IF
 * no admin account exists yet in the system. Subsequent calls return 409.
 * No body required — just a valid Clerk session token.
 */
router.post("/admin/bootstrap", async (req: Request, res: Response) => {
  const auth = getAuth(req);
  if (!auth.userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  const client = clerkClient;

  // Check if any admin already exists by scanning users
  // (Clerk doesn't support metadata filtering, so we page through users)
  let offset = 0;
  const limit = 100;
  let adminFound = false;

  outer: while (true) {
    const page = await client.users.getUserList({ limit, offset });
    for (const u of page.data) {
      if ((u.publicMetadata as Record<string, unknown>)?.plan === "admin") {
        adminFound = true;
        break outer;
      }
    }
    if (page.data.length < limit) break;
    offset += limit;
  }

  if (adminFound) {
    res.status(409).json({
      error: "An admin account already exists. Contact your admin to upgrade your plan.",
    });
    return;
  }

  // Promote this user to admin
  await client.users.updateUserMetadata(auth.userId, {
    publicMetadata: { plan: "admin" },
  });

  res.json({ message: "You have been granted admin access.", plan: "admin" });
});

/**
 * POST /api/admin/set-plan
 *
 * Requires the caller to be authenticated with an `admin` plan in their
 * publicMetadata. Sets publicMetadata.plan on the target user (looked up by email).
 *
 * Body: { email: string, plan: "free" | "pro" | "admin" }
 */
router.post("/admin/set-plan", async (req: Request, res: Response) => {
  const auth = getAuth(req);
  if (!auth.userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  const client = clerkClient;

  // Verify the caller is an admin
  const caller = await client.users.getUser(auth.userId);
  const callerPlan = (caller.publicMetadata as Record<string, unknown>)?.plan;
  if (callerPlan !== "admin") {
    res.status(403).json({ error: "Admin access required" });
    return;
  }

  const { email, plan } = req.body as { email?: unknown; plan?: unknown };

  if (typeof email !== "string" || !email.includes("@")) {
    res.status(400).json({ error: "Invalid or missing email address" });
    return;
  }

  if (!VALID_PLANS.includes(plan as Plan)) {
    res.status(400).json({ error: `Invalid plan. Must be one of: ${VALID_PLANS.join(", ")}` });
    return;
  }

  // Find user by email
  const users = await client.users.getUserList({ emailAddress: [email] });
  if (!users.data.length) {
    res.status(404).json({ error: `No user found with email: ${email}` });
    return;
  }

  const targetUser = users.data[0];

  // Update plan in publicMetadata
  await client.users.updateUserMetadata(targetUser.id, {
    publicMetadata: { plan },
  });

  res.json({
    message: `User ${email} has been updated to the '${plan as string}' plan.`,
    userId: targetUser.id,
    plan,
  });
});

export default router;
