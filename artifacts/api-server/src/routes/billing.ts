import { Router, type Request, type Response } from "express";
import { getAuth, clerkClient } from "@clerk/express";
import { pool } from "../lib/db";
import { getUncachableStripeClient, getStripeWebhookSecret } from "../lib/stripeClient";
import Stripe from "stripe";

const router = Router();

const APP_URL = process.env.APP_URL ?? `https://${process.env.REPLIT_DOMAINS?.split(",")[0] ?? "localhost"}`;

/**
 * POST /api/billing/start-verification — DISABLED
 * Age verification via Stripe Identity is currently disconnected.
 */
router.post("/billing/start-verification", (_req: Request, res: Response) => {
  res.status(503).json({ error: "Age verification is not currently active." });
});

/**
 * GET /api/billing/verification-status — DISABLED
 */
router.get("/billing/verification-status", (_req: Request, res: Response) => {
  res.json({ status: "not_started", verified: false });
});

/**
 * POST /api/billing/checkout — DISABLED
 * Stripe billing is currently disconnected. Plans are managed manually by admin.
 */
router.post("/billing/checkout", (_req: Request, res: Response) => {
  res.status(503).json({ error: "Billing is not currently active. Contact us to upgrade your plan." });
});

/**
 * POST /api/billing/portal — DISABLED
 */
router.post("/billing/portal", (_req: Request, res: Response) => {
  res.status(503).json({ error: "Billing portal is not currently active." });
});

/**
 * POST /api/billing/webhook
 * Kept active so Stripe webhook infrastructure stays intact for future reconnection.
 * Handles subscription and plan sync events.
 */
export async function handleBillingWebhook(req: Request, res: Response): Promise<void> {
  const sig = req.headers["stripe-signature"];
  if (!sig) {
    res.status(400).json({ error: "Missing stripe-signature" });
    return;
  }

  const payload = req.body as Buffer;
  if (!Buffer.isBuffer(payload)) {
    res.status(500).json({ error: "Payload must be a Buffer. Ensure webhook route is before express.json()." });
    return;
  }

  let event: Stripe.Event;
  try {
    const webhookSecret = await getStripeWebhookSecret();
    if (!webhookSecret) {
      res.status(500).json({ error: "Stripe webhook secret not configured" });
      return;
    }
    const stripe = await getUncachableStripeClient();
    const sigStr = Array.isArray(sig) ? sig[0] : sig;
    event = stripe.webhooks.constructEvent(payload, sigStr, webhookSecret);
  } catch (err) {
    console.error("Webhook signature verification failed:", err);
    res.status(400).json({ error: "Invalid signature" });
    return;
  }

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      const customerId = typeof session.customer === "string" ? session.customer : session.customer?.id;
      if (customerId) {
        await setPlanByCustomerId(customerId, "subscriber");
      }
    } else if (event.type === "customer.subscription.deleted") {
      const sub = event.data.object as Stripe.Subscription;
      const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
      await setPlanByCustomerId(customerId, "free");
    } else if (event.type === "identity.verification_session.verified") {
      const session = event.data.object as Stripe.Identity.VerificationSession;
      const clerkId = session.metadata?.clerkId;
      if (clerkId) {
        await clerkClient.users.updateUserMetadata(clerkId, {
          privateMetadata: { identitySessionId: null, identityVerified: true },
        });
        console.log(`Identity verified for user ${clerkId} via webhook`);
      }
    }
  } catch (err) {
    console.error("Webhook processing error:", err);
    res.status(500).json({ error: "Webhook processing failed" });
    return;
  }

  res.json({ received: true });
}

async function setPlanByCustomerId(customerId: string, plan: "subscriber" | "free"): Promise<void> {
  const { rows } = await pool.query(
    `UPDATE users SET plan = $1 WHERE stripe_customer_id = $2 RETURNING clerk_id`,
    [plan, customerId]
  );
  if (rows.length === 0) {
    console.warn(`No user found for Stripe customer ${customerId}`);
    return;
  }
  const clerkId = (rows[0] as { clerk_id: string }).clerk_id;
  await clerkClient.users.updateUserMetadata(clerkId, {
    publicMetadata: { plan },
  });
  console.log(`Updated user ${clerkId} plan to ${plan}`);
}

export default router;
