import { getUncachableStripeClient } from "../../artifacts/api-server/src/lib/stripeClient.js";

/**
 * Creates the Subscriber Plan product and monthly price in Stripe.
 * Idempotent — safe to run multiple times.
 *
 * Run with:
 *   pnpm --filter @workspace/scripts exec tsx src/seed-products.ts
 */
async function createProducts() {
  try {
    const stripe = await getUncachableStripeClient();

    console.log("Checking for existing Subscriber Plan product...");
    const existing = await stripe.products.search({
      query: "name:'Subscriber Plan' AND active:'true'",
    });

    if (existing.data.length > 0) {
      const product = existing.data[0];
      console.log(`Product already exists: ${product.name} (${product.id})`);
      const prices = await stripe.prices.list({ product: product.id, active: true });
      for (const p of prices.data) {
        console.log(`  Price: ${p.id}  $${(p.unit_amount ?? 0) / 100}/${p.recurring?.interval}`);
        console.log(`  Set STRIPE_PRICE_ID=${p.id} in your environment`);
      }
      return;
    }

    console.log("Creating Subscriber Plan product...");
    const product = await stripe.products.create({
      name: "Subscriber Plan",
      description: "Full access to all Handy Controller features including Games, Live Audio, AI Control, and Community sharing.",
    });
    console.log(`Created product: ${product.name} (${product.id})`);

    const price = await stripe.prices.create({
      product: product.id,
      unit_amount: 999,
      currency: "usd",
      recurring: { interval: "month" },
    });
    console.log(`Created monthly price: $${(price.unit_amount ?? 0) / 100}/month (${price.id})`);
    console.log(`\nIMPORTANT: Set STRIPE_PRICE_ID=${price.id} in your Replit environment secrets`);
    console.log("Done!");
  } catch (err: unknown) {
    console.error("Error:", (err as Error).message);
    process.exit(1);
  }
}

createProducts();
