# Threat Model

## Project Overview

HapticOS is a pnpm monorepo with a React/Vite frontend (`artifacts/handy-controller`) and an Express 5 API (`artifacts/api-server`) backed by PostgreSQL. Users authenticate with Clerk, complete onboarding and Stripe Identity verification, manage a private script library, share community scripts, use subscriber-gated features, and interact with Stripe billing flows. Production security risk is concentrated in the API server and any frontend path that turns stored user content into DOM or navigation behavior.

## Assets

- **User accounts and session identity** — Clerk user IDs, bearer tokens, onboarding state, age-verification state, and plan metadata. Compromise enables impersonation or privilege escalation.
- **Authorization state** — `plan` and `onboarded` metadata in Clerk plus mirrored values in the `users` table. Incorrect changes can unlock admin/subscriber features or block legitimate users.
- **Private user content** — private library entries, attached funscripts, scripter drafts, and saved sessions. These are user-scoped and must not be exposed or modified across accounts.
- **Community content integrity** — shared scripts, ratings, favorites, and analytics. Unauthorized writes or deletes can undermine trust in the platform.
- **Payment and verification state** — Stripe customer IDs, subscription state, portal/checkout sessions, Stripe Identity session IDs, and webhook processing. Tampering can grant paid access or break billing.
- **Application secrets** — Stripe secret/webhook credentials, database connection string, Clerk secret key, and Replit connector credentials.
- **Operational logs** — block reports, request logs, and analytics events. These can contain user-supplied text and limited PII.

## Trust Boundaries

- **Browser to API boundary** — every request from the frontend crosses into the Express API. The browser is untrusted; the API must authenticate and authorize each sensitive action.
- **Authenticated user to admin boundary** — admin routes and plan-management actions must never rely on frontend gating alone.
- **Public/legacy API to protected data boundary** — older routes such as `/api/scripts` remain mounted alongside newer Clerk-protected routes and must not trust caller-supplied ownership fields.
- **API to PostgreSQL boundary** — the API has direct access to user data and authorization state. Query construction and row scoping determine whether one user can affect another.
- **API to Clerk boundary** — the server can update Clerk metadata for plans, onboarding, and identity verification. Mistakes here can permanently alter account privileges.
- **API to Stripe boundary** — checkout, portal, identity verification, and webhook processing rely on Stripe as an external authority.
- **Internal/dev to production boundary** — `artifacts/mockup-sandbox` is assumed never deployed and is out of scope unless production reachability is demonstrated.

## Scan Anchors

- **Production entry points:** `artifacts/api-server/src/index.ts`, `artifacts/api-server/src/app.ts`, `artifacts/api-server/src/routes/*`, `artifacts/handy-controller/src/App.tsx`.
- **Highest-risk server areas:** `routes/admin.ts`, `routes/billing.ts`, `routes/scripts.ts`, `routes/community.ts`, `routes/library.ts`, `routes/media-funscripts.ts`.
- **Surface split:** public/legacy = `/api/health`, `/api/users/check-username`, `/api/scripts*`; authenticated = library, community, onboarding, usage, drafts, billing; admin = `/api/admin/*`.
- **Usually ignore unless proven reachable:** `artifacts/mockup-sandbox/**`, build outputs in `dist/**`.

## Threat Categories

### Spoofing

Authentication is provided by Clerk bearer tokens, but the API also exposes older routes that may not require Clerk at all. The system must ensure that every write or destructive action is bound to a trusted authenticated identity rather than caller-supplied `author_id`, email, or similar fields. Stripe webhooks must continue to require valid signatures before mutating billing state.

### Tampering

Users can submit titles, descriptions, URLs, funscript JSON, ratings, favorites, and plan-management requests. The API must validate input structure and, more importantly, enforce ownership on every update, delete, favorite, rating, and admin action. Client-visible buttons or plan badges are not security controls.

### Information Disclosure

Private library data, drafts, sessions, Stripe-linked identifiers, and internal user/account identifiers must only be returned to the owning user or an authorized admin. Error handling and logging must avoid exposing secrets, tokens, or more personal data than necessary. Legacy endpoints need extra scrutiny because they predate the current auth model.

### Denial of Service

The application accepts large JSON payloads (up to 10 MB) for funscripts and exposes several write-heavy routes. Rate limits and bounded parsing are required on public or semi-public endpoints so attackers cannot cheaply exhaust CPU, database, or log capacity. External calls to Stripe/connector services should remain time-bounded.

### Elevation of Privilege

The highest-risk failure mode is an authenticated non-admin user gaining admin or subscriber capabilities, or an unauthenticated caller modifying another user's content. Admin bootstrap, plan changes, webhook-driven plan updates, and any route that trusts user-controlled ownership identifiers must all be treated as privilege boundaries. All privileged state changes must be enforced server-side and tied to trusted identities only.
