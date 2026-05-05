import Stripe from "stripe";

/**
 * Creates the Subscriber Plan product and monthly price in Stripe.
 * Idempotent — safe to run multiple times.
 *
 * Run with:
 *   pnpm --filter @workspace/scripts exec tsx src/seed-products.ts
 */

async function getUncachableStripeClient(): Promise<Stripe> {
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY
    ? "repl " + process.env.REPL_IDENTITY
    : process.env.WEB_REPL_RENEWAL
      ? "depl " + process.env.WEB_REPL_RENEWAL
      : null;

  if (!hostname || !xReplitToken) {
    throw new Error(
      "Missing Replit environment variables. " +
      "Ensure the Stripe integration is connected via the Integrations tab."
    );
  }

  const isProduction = process.env.REPLIT_DEPLOYMENT === "1";
  const targetEnvironment = isProduction ? "production" : "development";

  const url = new URL(`https://${hostname}/api/v2/connection`);
  url.searchParams.set("include_secrets", "true");
  url.searchParams.set("connector_names", "stripe");
  url.searchParams.set("environment", targetEnvironment);

  const response = await fetch(url.toString(), {
    headers: {
      Accept: "application/json",
      "X-Replit-Token": xReplitToken,
    },
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch Stripe credentials: ${response.status} ${response.statusText}`);
  }

  const data = await response.json() as {
    items?: Array<{ settings?: { publishable?: string; secret?: string; webhook_secret?: string } }>;
  };

  const settings = data.items?.[0]?.settings;

  if (!settings?.secret) {
    throw new Error(
      `Stripe ${targetEnvironment} connection not found or missing keys. ` +
      "Connect Stripe via the Integrations tab first."
    );
  }

  return new Stripe(settings.secret);
}

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
