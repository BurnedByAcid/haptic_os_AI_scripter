import Stripe from "stripe";
import { StripeSync } from "stripe-replit-sync";

async function getCredentials(): Promise<{ publishableKey: string; secretKey: string }> {
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY
    ? "repl " + process.env.REPL_IDENTITY
    : process.env.WEB_REPL_RENEWAL
      ? "depl " + process.env.WEB_REPL_RENEWAL
      : null;

  if (!xReplitToken) {
    throw new Error("X-Replit-Token not found for repl/depl");
  }

  const connectorName = "stripe";
  const isProduction = process.env.REPLIT_DEPLOYMENT === "1";
  const targetEnvironment = isProduction ? "production" : "development";

  const url = new URL(`https://${hostname}/api/v2/connection`);
  url.searchParams.set("include_secrets", "true");
  url.searchParams.set("connector_names", connectorName);
  url.searchParams.set("environment", targetEnvironment);

  const response = await fetch(url.toString(), {
    headers: {
      Accept: "application/json",
      "X-Replit-Token": xReplitToken,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch Stripe credentials: ${response.status} ${response.statusText}`);
  }

  const data = await response.json() as {
    items?: Array<{ settings?: { publishable?: string; secret?: string } }>;
  };

  const settings = data.items?.[0]?.settings;

  if (!settings?.publishable || !settings?.secret) {
    throw new Error(
      `Stripe ${targetEnvironment} connection not found or missing keys. ` +
      "Connect Stripe via the Integrations tab first."
    );
  }

  return {
    publishableKey: settings.publishable,
    secretKey: settings.secret,
  };
}

export async function getStripeSecretKey(): Promise<string> {
  const { secretKey } = await getCredentials();
  return secretKey;
}

export async function getStripePublishableKey(): Promise<string> {
  const { publishableKey } = await getCredentials();
  return publishableKey;
}

export async function getUncachableStripeClient(): Promise<Stripe> {
  const { secretKey } = await getCredentials();
  return new Stripe(secretKey);
}

export function createStripeSync(secretKey: string): StripeSync {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL environment variable is required");
  }
  return new StripeSync({
    poolConfig: { connectionString: databaseUrl, max: 2 },
    stripeSecretKey: secretKey,
  });
}
