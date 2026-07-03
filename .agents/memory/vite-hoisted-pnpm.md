---
name: Vite bin shim broken in hoisted pnpm mode
description: After switching to node-linker=hoisted, per-package .bin/vite scripts reference old .pnpm store paths that no longer exist; pnpm adds per-package .bin/ first in PATH so root node_modules/.bin/ is never reached.
---

# Problem
After `pnpm install` with `node-linker=hoisted` + `shamefully-hoist=true`, per-package `.bin/vite` shims under `.github/workflows/artifacts/<pkg>/node_modules/.bin/vite` still reference the old pnpm store path (`.pnpm/vite@7.x.x.../node_modules/vite/bin/vite.js`) which no longer exists. Because pnpm adds per-package `.bin/` first in PATH when running scripts, creating a correct root `node_modules/.bin/vite` doesn't help.

# Fix
Change the artifact's `services.development.run` command in `artifact.toml` to bypass pnpm scripts entirely:

```toml
[services.development]
run = "sh -c 'cd /home/runner/workspace/.github/workflows/artifacts/handy-controller && node /home/runner/workspace/node_modules/vite/bin/vite.js --config vite.config.ts --host 0.0.0.0'"
```

Key points:
- Use **absolute paths** — the workflow runner's CWD is not workspace root, so relative `cd` fails.
- Must update via `verifyAndReplaceArtifactToml()`, not direct file edit.
- Vite binary is at `/home/runner/workspace/node_modules/vite/bin/vite.js` in hoisted mode.

**Why:** pnpm run prepends the per-package .bin/ to PATH which takes priority. The shim was written for the old pnpm store layout and pnpm doesn't regenerate it on hoisted reinstall.
