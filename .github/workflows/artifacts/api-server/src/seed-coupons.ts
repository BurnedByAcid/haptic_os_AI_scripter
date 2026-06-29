/**
 * Seed script: create the "Early Bird" coupon — 50% off first month, max 100 redemptions.
 * Idempotent — skips creation if a valid early-bird coupon already exists.
 *
 * Run: node /path/to/tsx artifacts/api-server/src/seed-coupons.ts
 */
import { getUncachableStripeClient } from "./lib/stripeClient";

const COUPON_ID = "HAPTICOS_EARLY_BIRD_50";

async function seed() {
  const stripe = await getUncachableStripeClient();

  try {
    const existing = await stripe.coupons.retrieve(COUPON_ID);
    console.log(`Coupon already exists: ${existing.id}`);
    console.log(`  ${existing.percent_off}% off — redeemed ${existing.times_redeemed}/${existing.max_redemptions} times`);
    console.log(`  Valid: ${existing.valid}`);
    console.log(`\nYour STRIPE_EARLY_BIRD_COUPON_ID:\n  ${existing.id}`);
    return;
  } catch {
    // Doesn't exist yet — create it
  }

  console.log("Creating Early Bird coupon…");
  const coupon = await stripe.coupons.create({
    id: COUPON_ID,
    name: "Early Bird — 50% off first month",
    percent_off: 50,
    duration: "once",
    max_redemptions: 100,
  });

  console.log(`Created coupon: ${coupon.id}`);
  console.log(`  ${coupon.percent_off}% off first month — limited to ${coupon.max_redemptions} customers`);
  console.log(`\nSet this as your STRIPE_EARLY_BIRD_COUPON_ID:\n  ${coupon.id}`);
}

seed().catch((err) => {
  console.error("Seed failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
