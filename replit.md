# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)
- **Payments**: Stripe (via Replit connector integration + stripe-replit-sync)

## Artifacts

### Handy Controller (`artifacts/handy-controller`, preview path: `/`)
Full-featured browser-based controller for The Handy device. Entirely client-side — calls the Handy REST API directly using the user's connection key.

**Pages:**
- `/` — Dashboard (device status, quick stats, navigation, Scripter usage count for free users)
- `/player` — Video + Funscript Player (local video + up to 4 scripts, real-time sync)
- `/control` — Manual device control (speed/stroke sliders)
- `/library` — Personal library (IndexedDB for local video/funscript storage)
- `/games` — Fappy Bird game with live Handy strokes per flap
- `/beat` — Beat 2 Beat (mic/MP3 beat detection → Handy strokes)
- `/scripter` — Funscript editor (timeline + Visual Trigger 5×5 pixel color matching). **Free tier: max 2 sessions/day, enforced server-side via `scripter_usage` table.**
- `/ai` — AI Control (text/voice chat with personas that control Handy)
- `/upgrade` — Plan comparison page (Free vs Subscriber). Subscriber button opens Stripe Checkout. Manage Subscription opens Stripe Portal.
- `/admin` — Admin panel (admin-only: set user plan by email via Clerk backend API)
- `/onboarding` — One-time onboarding for new users: age verification checkbox + username selection

**Key files:**
- `src/lib/handyApi.ts` — Handy v2 REST API client (getStatus, setHAMP, setHDSP, stopDevice)
- `src/lib/scriptSync.ts` — rAF-based funscript sync engine
- `src/lib/db.ts` — IndexedDB wrapper via `idb`
- `src/hooks/use-handy.ts` — Connection key state + device polling hook
- `src/hooks/use-subscription.ts` — Reads plan from Clerk publicMetadata ("free"|"pro"|"subscriber"|"admin")
- `src/components/layout.tsx` — Persistent sidebar with nav + connection key input + plan badge
- `src/components/plan-badge.tsx` — Inline plan tier badge (Free/Subscriber/Admin)
- `src/components/premium-gate.tsx` — Locked overlay for gated content (passes for pro/subscriber/admin)

**Subscription tiers:** Stored in `user.publicMetadata.plan` (Clerk). Four tiers:
- `free` (default) — 2 Scripter sessions/day, no premium features
- `subscriber` — Full access, set by Stripe webhook on `checkout.session.completed`
- `pro` — Legacy full access, manually granted by admin
- `admin` — Admin + full access

**Stripe Billing Flow:**
- `POST /api/billing/checkout` — Creates Stripe Checkout Session, redirects to Stripe
- `POST /api/billing/portal` — Creates Stripe Customer Portal session for managing/cancelling
- `POST /api/billing/webhook` — Raw-body webhook; handles `checkout.session.completed` (→ subscriber) and `customer.subscription.deleted` (→ free). **MUST be registered BEFORE express.json() in app.ts.**

**Env vars required for Stripe:**
- Stripe integration must be connected via Replit Integrations tab (provides secret key + webhook secret via credential proxy)
- `STRIPE_PRICE_ID` — the Stripe Price ID for the monthly subscriber plan

**Onboarding / route guard:** New users (and existing users without a username) are redirected to `/onboarding` before they can access any protected page. The guard in `ProtectedRoute` checks `user.publicMetadata.onboarded === true`. The onboarding endpoint sets this flag in Clerk and inserts a row in the `users` DB table.

**Device selector:** Supports The Handy (native), Lovense, Kiiroo, OSR2/SR6, Kiiroo Keon, Other (Intiface). Stored in `localStorage("hc_device_id")`. Intiface devices show WS URL input + download link.

**Important:** Do NOT use `@radix-ui/react-select` — causes duplicate-React "invalid hook call" in this Vite setup. Use native `<select>` instead.

**Dependencies:** `idb` (IndexedDB), standard shadcn/ui + Tailwind v4, wouter routing

**Theme:** Dark-only, neon cyan (#00E5FF) accent, no light mode

### API Server (`artifacts/api-server`, preview path: `/api`)
Express 5 backend with Clerk auth middleware.

**Routes:**
- `GET /healthz` — health check
- `POST /api/admin/bootstrap` — one-time admin bootstrap (first user claims admin)
- `POST /api/admin/set-plan` — admin-only: set a user's plan by email (requires admin JWT)
- `GET /api/users/check-username?username=` — returns `{ available: boolean }` (public)
- `POST /api/users/onboard` — auth-required; saves username + age_verified to DB, sets Clerk onboarded flag
- `POST /api/billing/checkout` — auth-required; creates Stripe Checkout Session
- `POST /api/billing/portal` — auth-required; creates Stripe Customer Portal session
- `POST /api/billing/webhook` — raw body (no Clerk auth); handles Stripe webhook events for plan updates
- `GET /api/usage/scripter/today` — auth-required; returns today's Scripter session count
- `POST /api/usage/scripter/record` — auth-required; increments today's Scripter session count
- `GET /api/scripter-drafts` — auth-required; lists current user's draft slots (free + subscriber both allowed; free is read-only)
- `GET /api/scripter-drafts/:slot` — auth-required; returns one slot incl. `funscript_json`
- `PUT /api/scripter-drafts/:slot` — auth+subscriber-only; upserts a slot (1-3), re-validates name + funscript on every write, refreshes 10-day TTL
- `DELETE /api/scripter-drafts/:slot` — auth-required; removes a slot

**Stripe initialization:** `initStripe()` in `index.ts` runs `runMigrations()`, creates managed webhook, and runs `syncBackfill()` on startup. Fails gracefully if Stripe is not connected.

**Key files:**
- `src/lib/stripeClient.ts` — Fetches Stripe credentials from Replit connector proxy, exposes `getUncachableStripeClient()` and `getStripeSync()`
- `src/routes/billing.ts` — Checkout, portal, and webhook handler
- `src/routes/usage.ts` — Scripter daily usage tracking

### Database (lib/db)
Drizzle ORM + PostgreSQL. Schema in `lib/db/src/schema/index.ts`. Push changes with `pnpm --filter @workspace/db run push`.

**Tables:**
- `users` — `clerk_id` (PK), `username` (unique), `age_verified` (bool), `plan` (text, default 'free'), `stripe_customer_id` (text, nullable), `stripe_subscription_id` (text, nullable), `created_at`
- `scripter_usage` — `id` (PK), `user_id` (FK → users.clerk_id), `usage_date` (date), `count` (int). Unique on (user_id, usage_date).
- `scripter_drafts` — `id` (PK), `user_id` (FK → users.clerk_id), `slot` (1-3, CHECK), `name`, `funscript_json`, `updated_at`, `expires_at` (last write + 10 days). Unique on (user_id, slot). Subscriber-only feature; downgraded users keep read-only access until TTL expiry.
- `stripe.*` — Auto-managed by `stripe-replit-sync` (products, prices, customers, subscriptions, etc.)

### Scripts (`scripts/`)
- `src/seed-products.ts` — Creates the Subscriber Plan product + monthly price in Stripe (idempotent). Run with: `pnpm --filter @workspace/scripts exec tsx src/seed-products.ts`

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally
- `pnpm --filter @workspace/handy-controller run dev` — run Handy Controller frontend
- `pnpm --filter @workspace/scripts exec tsx src/seed-products.ts` — create Stripe products (run once after Stripe integration is connected)

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
