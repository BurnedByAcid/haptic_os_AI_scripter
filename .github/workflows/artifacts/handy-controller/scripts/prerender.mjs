/**
 * Post-build prerender script.
 *
 * Generates route-specific static HTML files so crawlers receive proper
 * metadata (title, description, canonical, OG/Twitter tags, robots) in
 * the initial HTTP response — without JavaScript execution.
 *
 * Output files:
 *   dist/public/player/index.html   — player-specific SEO head
 *   dist/public/sign-in/index.html  — noindex (auth-only page)
 *   dist/public/sign-up/index.html  — noindex (auth-only page)
 */

import { readFileSync, mkdirSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = resolve(__dirname, "../dist/public");
const templatePath = resolve(distDir, "index.html");

let template;
try {
  template = readFileSync(templatePath, "utf8");
} catch {
  console.error("prerender: dist/public/index.html not found — run vite build first.");
  process.exit(1);
}

/**
 * Replace the <title> tag content.
 */
function setTitle(html, title) {
  return html.replace(/<title>[^<]*<\/title>/, `<title>${title}</title>`);
}

/**
 * Set a <meta name="..."> or <meta property="..."> tag.
 * Replaces existing or inserts before </head>.
 */
function setMeta(html, attr, name, content) {
  const escaped = content.replace(/"/g, "&quot;");
  const pattern = new RegExp(`<meta\\s+${attr}="${name}"[^>]*>`, "i");
  const tag = `<meta ${attr}="${name}" content="${escaped}" />`;
  if (pattern.test(html)) {
    return html.replace(pattern, tag);
  }
  return html.replace("</head>", `  ${tag}\n  </head>`);
}

/**
 * Insert a <link rel="canonical"> tag, replacing any existing one.
 */
function setCanonical(html, href) {
  const pattern = /<link\s+rel="canonical"[^>]*>/i;
  const tag = `<link rel="canonical" href="${href}" />`;
  if (pattern.test(html)) {
    return html.replace(pattern, tag);
  }
  return html.replace("</head>", `  ${tag}\n  </head>`);
}

const ORIGIN = "https://hapticos.com";

const routes = [
  {
    path: "player",
    transform(html) {
      html = setTitle(html, "Player — HapticOS");
      html = setMeta(html, "name", "description", "Sync haptic scripts with any video and control your device in real time. Load a local file, paste a URL, or pick from your library — no account required.");
      html = setCanonical(html, `${ORIGIN}/player`);
      html = setMeta(html, "property", "og:title", "HapticOS Player — Sync Scripts with Any Video");
      html = setMeta(html, "property", "og:description", "Sync haptic scripts with any video and control your device in real time. Load a local file, paste a URL, or pick from your library — no account required.");
      html = setMeta(html, "property", "og:type", "website");
      html = setMeta(html, "property", "og:url", `${ORIGIN}/player`);
      html = setMeta(html, "name", "twitter:title", "HapticOS Player — Sync Scripts with Any Video");
      html = setMeta(html, "name", "twitter:description", "Sync haptic scripts with any video and control your device in real time. Load a local file, paste a URL, or pick from your library — no account required.");
      return html;
    },
  },
  {
    path: "sign-in",
    transform(html) {
      html = setTitle(html, "Sign In — HapticOS");
      html = setMeta(html, "name", "robots", "noindex,follow");
      return html;
    },
  },
  {
    path: "sign-up",
    transform(html) {
      html = setTitle(html, "Create Account — HapticOS");
      html = setMeta(html, "name", "robots", "noindex,follow");
      return html;
    },
  },
];

for (const route of routes) {
  const outDir = resolve(distDir, route.path);
  const outFile = resolve(outDir, "index.html");
  mkdirSync(outDir, { recursive: true });
  const html = route.transform(template);
  writeFileSync(outFile, html, "utf8");
  console.log(`prerender: wrote ${route.path}/index.html`);
}

console.log("prerender: done.");
