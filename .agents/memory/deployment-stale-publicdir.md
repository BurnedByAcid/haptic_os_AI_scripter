---
name: Deployment container silent crash - duplicate rewrites / two static artifacts
description: Causes and diagnostic for the pid1 silent crash pattern (zero logs after "Creating Autoscale service") that blocks every publish attempt.
---

# Deployment container silent crash

## Diagnostic signature

- Build phase succeeds (all artifacts build correctly, image pushed)
- Last build log line is "Creating Autoscale service" — then complete silence
- Zero container runtime logs from `fetchDeploymentLogs`
- `listDeploymentBuilds` shows every build as `failed`
- Everything works fine in dev / local production simulation

## Root cause (confirmed July 16 2026)

The Replit pid1 binary crashes silently if **two static artifacts both declare a rewrite with `from = "/"`**. The crash happens before pid1 initializes its logger, producing zero output. The startup probe never gets a response, the Cloud Run service creation times out after ~10 minutes, and the build is marked failed.

This was introduced on July 13 2026 when the aiscripter artifact (`kind = "web"`, `serve = "static"`) was added. Both the aiscripter and the handy-controller had `[[services.production.rewrites]] from = "/" to = "/index.html"`. Pid1 appears to use a global rewrite table (not scoped per artifact), so duplicate `from = "/"` entries trigger a panic.

## Fix applied

Removed the `[[services.production.rewrites]]` block from the aiscripter's `artifact.toml` entirely. The aiscripter's `index.html` is served by default for the root path `/aiscripter/`. Static assets are served normally. Deep links to sub-routes within the aiscripter SPA will not work unless they use hash-based routing.

## How to apply going forward

1. **Only one static artifact may use `from = "/"`** — the primary one (handy-controller in this project)
2. Secondary static artifacts (e.g. `/aiscripter/`) must either have no rewrites, or use a catch-all like `from = "/*"` scoped to their path prefix (using their full path prefix in the `from` field, e.g. `from = "/aiscripter/*"`)
3. After adding a new `serve = "static"` artifact, always check that no two artifacts share an identical `from` value in their rewrites

## Previously wrong diagnosis

An earlier session attributed the crash to a stale `publicDir` path (`artifacts/aiscripter/dist/public` instead of `.github/workflows/artifacts/aiscripter/dist/public`). That was NOT the cause — the June 28 successful build had a "wrong" publicDir and still deployed fine. The actual trigger is the duplicate rewrite.
