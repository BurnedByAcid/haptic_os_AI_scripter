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

## Artifacts

### Handy Controller (`artifacts/handy-controller`, preview path: `/`)
Full-featured browser-based controller for The Handy device. Entirely client-side — calls the Handy REST API directly using the user's connection key.

**Pages:**
- `/` — Dashboard (device status, quick stats, navigation)
- `/player` — Video + Funscript Player (local video + up to 4 scripts, real-time sync)
- `/control` — Manual device control (speed/stroke sliders)
- `/library` — Personal library (IndexedDB for local video/funscript storage)
- `/games` — Fappy Bird game with live Handy strokes per flap
- `/beat` — Beat 2 Beat (mic/MP3 beat detection → Handy strokes)
- `/scripter` — Funscript editor (timeline + Visual Trigger 5×5 pixel color matching)
- `/ai` — AI Control (text/voice chat with personas that control Handy)

**Key files:**
- `src/lib/handyApi.ts` — Handy v2 REST API client (getStatus, setHAMP, setHDSP, stopDevice)
- `src/lib/scriptSync.ts` — rAF-based funscript sync engine
- `src/lib/db.ts` — IndexedDB wrapper via `idb`
- `src/hooks/use-handy.ts` — Connection key state + device polling hook
- `src/components/layout.tsx` — Persistent sidebar with nav + connection key input

**Dependencies:** `idb` (IndexedDB), standard shadcn/ui + Tailwind v4, wouter routing

**Theme:** Dark-only, neon cyan (#00E5FF) accent, no light mode

### API Server (`artifacts/api-server`, preview path: `/api`)
Express 5 backend. Currently only has a health check endpoint. No routes needed by Handy Controller (all Handy API calls go directly to handyfeeling.com from the browser).

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally
- `pnpm --filter @workspace/handy-controller run dev` — run Handy Controller frontend

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
