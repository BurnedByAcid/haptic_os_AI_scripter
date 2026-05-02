import app from "./app";
import { logger } from "./lib/logger";
import { runMigrations } from "stripe-replit-sync";
import { getStripeSecretKey, createStripeSync } from "./lib/stripeClient";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

async function initStripe() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    logger.warn("DATABASE_URL not set — skipping Stripe initialization");
    return;
  }

  try {
    logger.info("Initializing Stripe schema...");
    await runMigrations({ databaseUrl });
    logger.info("Stripe schema ready");

    const secretKey = await getStripeSecretKey();
    const stripeSync = createStripeSync(secretKey);

    const webhookBaseUrl = `https://${process.env.REPLIT_DOMAINS?.split(",")[0]}`;
    logger.info({ url: `${webhookBaseUrl}/api/billing/webhook` }, "Setting up managed webhook...");
    await stripeSync.findOrCreateManagedWebhook(`${webhookBaseUrl}/api/billing/webhook`);
    logger.info("Stripe webhook configured");

    stripeSync.syncBackfill().then(() => {
      logger.info("Stripe data synced");
    }).catch((err) => {
      logger.error({ err }, "Error syncing Stripe data");
    });
  } catch (err) {
    logger.error({ err }, "Failed to initialize Stripe — continuing without it");
  }
}

await initStripe();

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});
