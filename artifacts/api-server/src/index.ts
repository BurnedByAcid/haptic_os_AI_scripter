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

/**
 * One-time backfill: copy every legacy `private_library.funscript` into the
 * new `private_library_funscripts` table as a row named "Default" marked
 * active. Idempotent — INSERT…SELECT…WHERE NOT EXISTS skips entries that
 * already have at least one row in the new table, so safe to run on every
 * boot. Once every row in private_library has a corresponding row in
 * private_library_funscripts this is a no-op.
 */
async function migrateLegacyFunscripts(): Promise<void> {
  if (!process.env.DATABASE_URL) return;
  try {
    const { rowCount } = await pool.query(
      `INSERT INTO private_library_funscripts
         (library_id, user_id, name, funscript_json, is_active, created_at, updated_at)
       SELECT pl.id, pl.user_id, 'Default', pl.funscript, TRUE, NOW(), NOW()
       FROM private_library pl
       WHERE NOT EXISTS (
         SELECT 1 FROM private_library_funscripts plf WHERE plf.library_id = pl.id
       )
       ON CONFLICT (library_id, name) DO NOTHING`,
    );
    if (rowCount && rowCount > 0) {
      logger.info({ migrated: rowCount }, "Backfilled legacy private_library funscripts");
    }
  } catch (err) {
    logger.error({ err }, "Failed to backfill legacy funscripts — continuing");
  }
}

await initStripe();
await migrateLegacyFunscripts();

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});
