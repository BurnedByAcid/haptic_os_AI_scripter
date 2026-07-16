/**
 * Seed script: create HapticOS Subscriber product + $9.99/month price in Stripe.
 * Idempotent — skips creation if the product already exists.
 *
 * Run: pnpm --filter @workspace/api-server exec tsx src/seed-products.ts
 */
import { getUncachableStripeClient } from "./lib/stripeClient";

async function seed() {
  const stripe = await getUncachableStripeClient();

  // Check if product already exists
  const existing = await stripe.products.search({
    query: "name:'HapticOS Subscriber' AND active:'true'",
  });

  if (existing.data.length > 0) {
    const product = existing.data[0];
    console.log(`Product already exists: ${product.id}`);

    const prices = await stripe.prices.list({ product: product.id, active: true });
    for (const price of prices.data) {
      console.log(
        `  Price: ${price.id}  $${(price.unit_amount ?? 0) / 100}/${price.recurring?.interval}`
      );
    }
    return;
  }

  console.log("Creating HapticOS Subscriber product…");
  const product = await stripe.products.create({
    name: "HapticOS Subscriber",
    description: "Full access to HapticOS — unlimited Scripter sessions, Games, Live Audio, Community, and more.",
  });
  console.log(`Created product: ${product.id}`);

  const price = await stripe.prices.create({
    product: product.id,
    unit_amount: 999, // $9.99
    currency: "usd",
    recurring: { interval: "month" },
  });
  console.log(`Created price: ${price.id}  $9.99/month`);
  console.log(`\nSet this as your STRIPE_PRICE_ID:\n  ${price.id}`);
}

seed().catch((err) => {
  console.error("Seed failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
