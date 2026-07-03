---
name: Deeply-nested pnpm workspace symlinks
description: When workspace packages live > 2 levels deep, pnpm generates @workspace/* symlinks with wrong relative depth; workaround is explicit alias maps.
---

# Problem
Packages at `.github/workflows/artifacts/<pkg>/` are 4 directory levels deep from workspace root (not the typical 2 for `packages/<pkg>/`). pnpm computes `@workspace/*` symlink paths as if packages are 2 levels deep, so the symlinks resolve to `.github/workflows/lib/*` instead of `lib/*` at the workspace root — those paths don't exist.

# Fix for api-server (esbuild)
Add `alias` to `build.mjs`:
```js
const workspaceRoot = path.resolve(artifactDir, '../../../../');
// in esbuild config:
alias: {
  "@workspace/validation": path.resolve(workspaceRoot, "lib/validation/src/index.ts"),
  "@workspace/api-zod":    path.resolve(workspaceRoot, "lib/api-zod/src/index.ts"),
  "@workspace/db":         path.resolve(workspaceRoot, "lib/db/src/index.ts"),
},
```

# Fix for handy-controller (vite)
Add `resolve.alias` in `vite.config.ts` AND `server.fs.allow` for the workspace root:
```js
resolve: {
  alias: {
    "@workspace/validation": path.resolve(import.meta.dirname, "../../../../lib/validation/src/index.ts"),
  },
},
server: {
  fs: {
    strict: true,
    allow: [
      path.resolve(import.meta.dirname, "../../../../"),  // workspace root
      path.resolve(import.meta.dirname),
    ],
  },
},
```

**Why:** pnpm's symlink path computation assumes packages are at most 2 levels from workspace root. When packages are deeper, the relative path is off by (actual_depth - 2) * 2 levels.

**How to apply:** Whenever a new workspace package is added to `.github/workflows/artifacts/` that imports `@workspace/*`, add its alias to both `build.mjs` (api-server) and `vite.config.ts` (frontend).

# tsconfig.json extends path
Also broken for the same reason — `"extends": "../../tsconfig.base.json"` should be `"../../../../tsconfig.base.json"` for these deep packages. Same for `references` paths.
