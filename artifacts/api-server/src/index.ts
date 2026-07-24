import app from "./app";
import { logger } from "./lib/logger";
import { runMigrations } from "stripe-replit-sync";
import { getStripeSync } from "./lib/stripeClient";
import { pool } from "./lib/db";

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

async function runLocalMigrations() {
  try {
    await pool.query(`
      ALTER TABLE community_scripts
      ADD COLUMN IF NOT EXISTS cached_video_size_bytes BIGINT
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS platform_config (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `);
    logger.info("Local migrations applied");
  } catch (err) {
    logger.error({ err }, "Failed to apply local migrations — continuing");
  }
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

    const stripeSync = await getStripeSync();

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

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  // Run local DB migrations, then Stripe — both after the port is open so
  // the startup health probe can succeed immediately.
  runLocalMigrations().catch((err) => {
    logger.error({ err }, "Local migrations failed");
  });

  initStripe().catch((err) => {
    logger.error({ err }, "Stripe initialization failed");
  });
});
