# SEO Strategy

## In scope
- Public-facing web app surfaces under `artifacts/handy-controller`
- Public-facing web app surfaces under `artifacts/aiscripter`
- Initial HTML shells, prerendered static output, public assets, robots/sitemap/llms files, deployment routing, and social sharing metadata

## Out of scope
- Authenticated application routes and admin screens unless they are unintentionally indexable from a public URL
- API endpoints under `artifacts/api-server/src`
- Localhost-only companion UI under `artifacts/hapticai-server` (binds to `127.0.0.1` by default and is not intended for internet indexing)

## Target audience
- Users looking for haptic device control, video/script sync, and AI-assisted funscript generation tools

## Primary keywords
- HapticOS
- haptic device control
- funscript player
- AI funscript generator

## Current public route notes
- `artifacts/handy-controller`: `/player` is the only clearly public, intended discovery target in the current source.
- `artifacts/handy-controller`: `/sign-in` and `/sign-up` are user-facing utility routes but are intentionally `noindex`.
- `artifacts/handy-controller`: `/` and most other routes are authenticated or gated and should not be treated as public landing pages unless the app publishes real public HTML there.
- `artifacts/aiscripter`: `/aiscripter/` currently behaves as a gated app shell, not a public marketing or editorial landing page.

## Dismissed categories
- (None yet)
