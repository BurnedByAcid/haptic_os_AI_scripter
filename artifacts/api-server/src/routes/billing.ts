import { Router, type Request, type Response } from "express";
import { getAuth, clerkClient } from "@clerk/express";
import { pool } from "../lib/db";
import { getUncachableStripeClient, getStripeSecretKey } from "../lib/stripeClient";
import Stripe from "stripe";

const router = Router();

const SUBSCRIBER_PRICE_ID = process.env.STRIPE_PRICE_ID ?? "";
const APP_URL = process.env.APP_URL ?? `https://${process.env.REPLIT_DOMAINS?.split(",")[0] ?? "localhost"}`;

/**
 * POST /api/billing/checkout
 * Creates a Stripe Checkout session and returns the URL.
 * Requires auth.
 */
router.post("/billing/checkout", async (req: Request, res: Response) => {
  const auth = getAuth(req);
  if (!auth.userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  try {
    const stripe = await getUncachableStripeClient();

    const { rows } = await pool.query(
      `SELECT stripe_customer_id FROM users WHERE clerk_id = $1`,
      [auth.userId]
    );
    const userRow = rows[0] as { stripe_customer_id?: string } | undefined;

    let customerId = userRow?.stripe_customer_id;

    if (!customerId) {
      const clerkUser = await clerkClient.users.getUser(auth.userId);
      const email = clerkUser.emailAddresses[0]?.emailAddress;
      const customer = await stripe.customers.create({
        email,
        metadata: { clerkId: auth.userId },
      });
      customerId = customer.id;
      await pool.query(
        `UPDATE users SET stripe_customer_id = $1 WHERE clerk_id = $2`,
        [customerId, auth.userId]
      );
    }

    const priceId = SUBSCRIBER_PRICE_ID;
    if (!priceId) {
      res.status(500).json({ error: "Stripe price ID not configured. Set STRIPE_PRICE_ID." });
      return;
    }

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ["card"],
      line_items: [{ price: priceId, quantity: 1 }],
      mode: "subscription",
      success_url: `${APP_URL}/upgrade?success=1`,
      cancel_url: `${APP_URL}/upgrade?canceled=1`,
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error("Checkout error:", err);
    res.status(500).json({ error: "Failed to create checkout session" });
  }
});

/**
 * POST /api/billing/portal
 * Creates a Stripe Customer Portal session for managing/cancelling subscription.
 * Requires auth.
 */
router.post("/billing/portal", async (req: Request, res: Response) => {
  const auth = getAuth(req);
  if (!auth.userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  try {
    const { rows } = await pool.query(
      `SELECT stripe_customer_id FROM users WHERE clerk_id = $1`,
      [auth.userId]
    );
    const userRow = rows[0] as { stripe_customer_id?: string } | undefined;
    const customerId = userRow?.stripe_customer_id;

    if (!customerId) {
      res.status(400).json({ error: "No billing account found. Please subscribe first." });
      return;
    }

    const stripe = await getUncachableStripeClient();
    const portalSession = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${APP_URL}/upgrade`,
    });

    res.json({ url: portalSession.url });
  } catch (err) {
    console.error("Portal error:", err);
    res.status(500).json({ error: "Failed to create portal session" });
  }
});

/**
 * POST /api/billing/webhook
 * Raw body — must be registered BEFORE express.json() in app.ts.
 * Handles Stripe webhook events to update user plan.
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
    const secretKey = await getStripeSecretKey();
    const stripe = new Stripe(secretKey);
    const sigStr = Array.isArray(sig) ? sig[0] : sig;
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET ?? "";
    if (!webhookSecret) {
      res.status(500).json({ error: "STRIPE_WEBHOOK_SECRET not configured" });
      return;
    }
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
