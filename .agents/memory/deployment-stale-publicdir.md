---
name: Deployment container silent crash - stale publicDir
description: How a wrong publicDir in artifact.toml causes the deployment container to crash silently, making the startup probe fail with no logs.
---

# Deployment container silent crash: stale publicDir in artifact.toml

## The Rule
When artifacts are moved to a new directory path, every `publicDir` in every `artifact.toml` must be updated to the new path BEFORE publishing. A stale path that doesn't exist in the container causes the Replit pid1 binary to crash at startup before any HTTP server starts.

## Why
The Replit deployment pid1 binary registers static file handlers for ALL `kind = "web"` artifacts at container startup. If any artifact's `publicDir` doesn't exist in the container image, the pid1 binary crashes silently — no logs, no HTTP server, startup probe gets "connection refused" every time, promote step times out.

## Diagnostic signature
- Zero container runtime logs after "Creating Autoscale service" in the deployment build log
- June 28 successful build had runtime logs like `starting artifact processes for monorepo deployment`, `registered static handler for artifact publicDir=...`
- Current failing builds end at "Creating Autoscale service" with nothing after it
- Server works fine locally in production mode
- Build phase succeeds (dist files are created correctly)

## How to apply
After any workspace restructuring (moving artifacts to new paths):
1. Check every `artifact.toml` for `publicDir` entries
2. Ensure each `publicDir` points to the ACTUAL build output path (e.g., `.github/workflows/artifacts/<name>/dist/public`)
3. The path is relative to workspace root

## Root cause in this project
Workspace was restructured from `artifacts/` → `.github/workflows/artifacts/` (commit 7324020, July 3 2026). The aiscripter artifact.toml retained `publicDir = "artifacts/aiscripter/dist/public"` (old path) when it was added on July 13 2026. Fixed by changing to `.github/workflows/artifacts/aiscripter/dist/public`.
