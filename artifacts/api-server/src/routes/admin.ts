import { Router, type IRouter, type Request, type Response } from "express";
import { getAuth, clerkClient } from "@clerk/express";
import { pool } from "../lib/db";
import { getUncachableStripeClient } from "../lib/stripeClient";
import { logger } from "../lib/logger";
import { deleteCachedVideo } from "../lib/communityMediaStorage";

const router: IRouter = Router();

const VALID_PLANS = ["free", "pro", "subscriber", "admin"] as const;
type Plan = typeof VALID_PLANS[number];

/**
 * POST /api/admin/bootstrap
 *
 * One-time endpoint: promotes the calling authenticated user to "admin" IF
 * no admin account exists yet in the system. Subsequent calls return 409.
 * Requires authentication AND the ADMIN_BOOTSTRAP_SECRET environment variable
 * to be provided in the request body as `bootstrapSecret`. This prevents any
 * authenticated user from claiming admin rights on a fresh or restored deployment.
 */
router.post("/admin/bootstrap", async (req: Request, res: Response) => {
  const auth = getAuth(req);
  if (!auth.userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  // Require an out-of-band secret known only to the legitimate operator.
  const requiredSecret = process.env.ADMIN_BOOTSTRAP_SECRET;
  if (!requiredSecret) {
    res.status(503).json({ error: "Admin bootstrap is not configured on this server." });
    return;
  }
  const { bootstrapSecret } = req.body as { bootstrapSecret?: unknown };
  if (typeof bootstrapSecret !== "string" || bootstrapSecret !== requiredSecret) {
    res.status(403).json({ error: "Invalid bootstrap secret." });
    return;
  }

  const client = clerkClient;

  // Acquire a Postgres advisory lock (key 1) to make the check-and-promote
  // sequence atomic. Only one concurrent bootstrap request can proceed at a
  // time; all others block until the lock is released at the end of the
  // database session (pg_advisory_unlock or connection close).
  const db = await pool.connect();
  try {
    await db.query("SELECT pg_advisory_lock(1)");

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

    // Promote this user to admin in both Clerk metadata and the DB so that
    // all DB-based plan checks (getPlan) immediately reflect the promotion.
    await Promise.all([
      client.users.updateUserMetadata(auth.userId, {
        publicMetadata: { plan: "admin" },
      }),
      db.query(
        "UPDATE users SET plan = 'admin' WHERE clerk_id = $1",
        [auth.userId],
      ),
    ]);

    res.json({ message: "You have been granted admin access.", plan: "admin" });
  } finally {
    // Always release the advisory lock and return the connection to the pool.
    await db.query("SELECT pg_advisory_unlock(1)");
    db.release();
  }
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

  // Update plan in both Clerk publicMetadata and in the database so that all
  // authorization checks (both Clerk-based and DB-based) reflect the change.
  // Note: these two writes are not distributed-atomic. If one succeeds and the
  // other fails, a partial-write state can occur temporarily. Failures are
  // logged explicitly so operators can identify and correct any divergence.
  const [clerkResult, dbResult] = await Promise.allSettled([
    client.users.updateUserMetadata(targetUser.id, {
      publicMetadata: { plan },
    }),
    pool.query(
      "UPDATE users SET plan = $1 WHERE clerk_id = $2",
      [plan, targetUser.id]
    ),
  ]);

  const clerkFailed = clerkResult.status === "rejected";
  const dbFailed = dbResult.status === "rejected";

  if (clerkFailed || dbFailed) {
    console.error("admin/set-plan partial write failure", {
      email,
      plan,
      userId: targetUser.id,
      clerkError: clerkFailed ? (clerkResult as PromiseRejectedResult).reason : undefined,
      dbError: dbFailed ? (dbResult as PromiseRejectedResult).reason : undefined,
    });

    if (clerkFailed && dbFailed) {
      res.status(500).json({ error: "Failed to update plan in both Clerk and the database. No change was applied." });
      return;
    }

    // One store was updated; report partial failure so the operator can reconcile.
    res.status(500).json({
      error: "Partial update failure: plan was updated in one store but not the other. Manual reconciliation may be required.",
      clerkUpdated: !clerkFailed,
      databaseUpdated: !dbFailed,
    });
    return;
  }

  res.json({
    message: `User ${email} has been updated to the '${plan as string}' plan.`,
    userId: targetUser.id,
    plan,
  });
});

/**
 * GET /api/admin/analytics
 * Returns aggregated stats for the admin dashboard.
 * Requires admin plan.
 */
router.get("/admin/analytics", async (req: Request, res: Response) => {
  const auth = getAuth(req);
  if (!auth.userId) { res.status(401).json({ error: "Not authenticated" }); return; }

  const caller = await clerkClient.users.getUser(auth.userId);
  if ((caller.publicMetadata as Record<string, unknown>)?.plan !== "admin") {
    res.status(403).json({ error: "Admin access required" }); return;
  }

  try {
    const [
      userPlans,
      newUsers,
      content,
      featureUsage,
    ] = await Promise.all([
      // User plan breakdown
      pool.query<{ plan: string; count: string }>(`
        SELECT plan, COUNT(*) AS count FROM users GROUP BY plan ORDER BY count DESC
      `),
      // New users in last 7 and 30 days
      pool.query<{ period: string; count: string }>(`
        SELECT
          COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days')  AS last_7,
          COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days') AS last_30
        FROM users
      `),
      // Content counts
      pool.query<Record<string, string>>(`
        SELECT
          (SELECT COUNT(*) FROM scripter_sessions)    AS scripter_sessions,
          (SELECT COUNT(*) FROM community_scripts)    AS community_scripts,
          (SELECT COALESCE(SUM(view_count),0) FROM community_scripts) AS community_views,
          (SELECT COUNT(*) FROM community_ratings)    AS community_ratings,
          (SELECT COUNT(*) FROM community_favorites)  AS community_favorites,
          0                                           AS library_entries,
          (SELECT COALESCE(SUM(cached_video_size_bytes), 0)
           FROM community_scripts
           WHERE cache_status = 'cached' AND cached_video_size_bytes IS NOT NULL
          )                                           AS cached_video_total_bytes
      `),
      // Feature usage (all time and last 30 days)
      pool.query<{ feature: string; total: string; last_30: string }>(`
        SELECT
          feature,
          COUNT(*)                                                            AS total,
          COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days')   AS last_30
        FROM analytics_events
        GROUP BY feature
        ORDER BY total DESC
      `),
    ]);

    // Build plan map
    const byPlan: Record<string, number> = {};
    let totalUsers = 0;
    for (const row of userPlans.rows) {
      byPlan[row.plan] = parseInt(row.count, 10);
      totalUsers += parseInt(row.count, 10);
    }

    // Early bird coupon
    let earlyBird: Record<string, unknown> = { configured: false };
    const couponId = process.env.STRIPE_EARLY_BIRD_COUPON_ID;
    if (couponId) {
      try {
        const stripe = await getUncachableStripeClient();
        const coupon = await stripe.coupons.retrieve(couponId);
        earlyBird = {
          configured: true,
          couponId: coupon.id,
          percentOff: coupon.percent_off,
          timesRedeemed: coupon.times_redeemed,
          maxRedemptions: coupon.max_redemptions,
          remaining: (coupon.max_redemptions ?? 0) - coupon.times_redeemed,
          valid: coupon.valid,
        };
      } catch {
        earlyBird = { configured: true, error: "Could not fetch coupon" };
      }
    }

    // Build feature map
    const features: Record<string, { total: number; last30: number }> = {};
    for (const row of featureUsage.rows) {
      features[row.feature] = {
        total: parseInt(row.total, 10),
        last30: parseInt(row.last_30, 10),
      };
    }

    const c = content.rows[0];
    const nu = newUsers.rows[0] as unknown as { last_7: string; last_30: string };

    const cachedVideoCapBytes = (() => {
      const raw = process.env.COMMUNITY_CACHE_MAX_TOTAL_BYTES?.trim();
      if (!raw) return 100 * 1024 * 1024 * 1024;
      const parsed = Number(raw);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : 100 * 1024 * 1024 * 1024;
    })();

    res.json({
      users: {
        total: totalUsers,
        byPlan,
        newLast7Days: parseInt(nu.last_7, 10),
        newLast30Days: parseInt(nu.last_30, 10),
      },
      content: {
        scripterSessions:       parseInt(c.scripter_sessions, 10),
        communityScripts:       parseInt(c.community_scripts, 10),
        communityViews:         parseInt(c.community_views, 10),
        communityRatings:       parseInt(c.community_ratings, 10),
        communityFavorites:     parseInt(c.community_favorites, 10),
        libraryEntries:         parseInt(c.library_entries, 10),
        cachedVideoTotalBytes:  Number(c.cached_video_total_bytes ?? 0),
        cachedVideoCapBytes,
      },
      features,
      earlyBird,
    });
  } catch (err) {
    logger.error({ err }, "Failed to load admin analytics");
    res.status(500).json({ error: "Failed to load analytics" });
  }
});

/**
 * GET /api/admin/feedback
 *
 * Returns the 200 most recent feedback submissions in descending order.
 * Requires admin plan.
 */
router.get("/admin/feedback", async (req: Request, res: Response) => {
  const auth = getAuth(req);
  if (!auth.userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  const caller = await clerkClient.users.getUser(auth.userId);
  const callerPlan = (caller.publicMetadata as Record<string, unknown>)?.plan;
  if (callerPlan !== "admin") {
    res.status(403).json({ error: "Admin access required" });
    return;
  }

  try {
    const result = await pool.query(
      `SELECT id, user_id, user_email, category, message, created_at
       FROM feedback
       ORDER BY created_at DESC
       LIMIT 200`
    );
    res.json(result.rows);
  } catch (err) {
    logger.error({ err }, "Failed to load admin feedback");
    res.status(500).json({ error: "Failed to load feedback" });
  }
});

/**
 * GET /api/admin/hapticai/releases
 *
 * Returns every hapticai_releases row ordered by platform then upload date
 * (newest first). Requires admin plan.
 */
router.get("/admin/hapticai/releases", async (req: Request, res: Response) => {
  const auth = getAuth(req);
  if (!auth.userId) { res.status(401).json({ error: "Not authenticated" }); return; }

  const caller = await clerkClient.users.getUser(auth.userId);
  if ((caller.publicMetadata as Record<string, unknown>)?.plan !== "admin") {
    res.status(403).json({ error: "Admin access required" }); return;
  }

  try {
    const { rows } = await pool.query<{
      id: number;
      platform: string;
      version: string;
      size_bytes: string;
      storage_key: string;
      uploaded_at: string;
    }>(
      `SELECT id, platform, version, size_bytes, storage_key, uploaded_at
       FROM hapticai_releases
       ORDER BY platform ASC, uploaded_at DESC`,
    );
    res.json(rows.map((r) => ({
      id: r.id,
      platform: r.platform,
      version: r.version,
      sizeBytes: Number(r.size_bytes),
      storageKey: r.storage_key,
      uploadedAt: r.uploaded_at,
    })));
  } catch (err) {
    logger.error({ err }, "Failed to load hapticai releases");
    res.status(500).json({ error: "Failed to load releases." });
  }
});

/**
 * DELETE /api/admin/community/:id
 *
 * Hard-deletes a community script (any user's) including its cached GCS
 * object. Requires admin plan. Use for policy violations / DMCA.
 */
router.delete("/admin/community/:id", async (req: Request, res: Response) => {
  const auth = getAuth(req);
  if (!auth.userId) { res.status(401).json({ error: "Not authenticated" }); return; }

  const caller = await clerkClient.users.getUser(auth.userId);
  if ((caller.publicMetadata as Record<string, unknown>)?.plan !== "admin") {
    res.status(403).json({ error: "Admin access required" }); return;
  }

  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  try {
    const { rows } = await pool.query(
      `SELECT id FROM community_scripts WHERE id = $1`,
      [id],
    );
    if (!rows.length) { res.status(404).json({ error: "Community script not found" }); return; }

    await deleteCachedVideo(id);

    await pool.query(`DELETE FROM community_scripts WHERE id = $1`, [id]);

    logger.info({ adminUserId: auth.userId, scriptId: id }, "Admin deleted community script");
    res.json({ ok: true, scriptId: id });
  } catch (err) {
    logger.error({ err, scriptId: id }, "Failed to admin-delete community script");
    res.status(500).json({ error: "Failed to delete community script" });
  }
});

/**
 * DELETE /api/admin/community/:id/cache
 *
 * Evicts the cached GCS object for a community script and resets
 * cache_status to 'failed' so the original video_url is served again.
 * Use for DMCA takedowns or manual cache cleanup.
 * Requires admin plan.
 */
router.delete("/admin/community/:id/cache", async (req: Request, res: Response) => {
  const auth = getAuth(req);
  if (!auth.userId) { res.status(401).json({ error: "Not authenticated" }); return; }

  const caller = await clerkClient.users.getUser(auth.userId);
  if ((caller.publicMetadata as Record<string, unknown>)?.plan !== "admin") {
    res.status(403).json({ error: "Admin access required" }); return;
  }

  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  try {
    const { rows } = await pool.query(
      `SELECT id, cached_video_url, cache_status FROM community_scripts WHERE id = $1`,
      [id],
    );
    if (!rows.length) { res.status(404).json({ error: "Community script not found" }); return; }

    await deleteCachedVideo(id);

    await pool.query(
      `UPDATE community_scripts SET cached_video_url = NULL, cache_status = 'failed' WHERE id = $1`,
      [id],
    );

    logger.info({ adminUserId: auth.userId, scriptId: id }, "Admin evicted community script cache");
    res.json({ ok: true, scriptId: id });
  } catch (err) {
    logger.error({ err, scriptId: id }, "Failed to evict community script cache");
    res.status(500).json({ error: "Failed to evict cache" });
  }
});

export default router;
