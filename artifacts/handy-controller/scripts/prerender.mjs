/**
 * Post-build prerender script.
 *
 * Generates route-specific static HTML files so crawlers receive proper
 * metadata (title, description, canonical, OG/Twitter tags, robots) in
 * the initial HTTP response — without JavaScript execution.
 *
 * Output files:
 *   dist/public/player/index.html   — player-specific SEO head + static body
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

/**
 * Insert a <script type="application/ld+json"> block before </head>.
 * Replaces any existing ld+json block if present.
 */
function setJsonLd(html, data) {
  const tag = `<script type="application/ld+json">${JSON.stringify(data)}</script>`;
  const existing = /<script\s+type="application\/ld\+json"[^>]*>[\s\S]*?<\/script>/i;
  if (existing.test(html)) {
    return html.replace(existing, tag);
  }
  return html.replace("</head>", `  ${tag}\n  </head>`);
}

/**
 * Replace the static body placeholder with pre-rendered crawlable content.
 * The React app still mounts into #root at runtime; this just gives non-JS
 * crawlers something meaningful to index before hydration.
 */
function setStaticBody(html, bodyHtml) {
  return html.replace(
    /<div id="root"><\/div>/,
    `<div id="root">${bodyHtml}</div>`
  );
}

const ORIGIN = "https://hapticos.com";

const PLAYER_STATIC_BODY = `
<main style="font-family:system-ui,sans-serif;max-width:960px;margin:0 auto;padding:24px">
  <h1>HapticOS Player</h1>
  <p>Sync haptic scripts with any video and control your device in real time. Load a local file, paste a URL, or pick from your library — no account required.</p>
  <section aria-label="Features">
    <h2>What you can do</h2>
    <ul>
      <li>Load a local video file and a Funscript (.funscript) to sync them frame-perfectly</li>
      <li>Paste a video URL from YouTube, Vimeo, Pornhub, xVideos, xHamster, RedTube, or any direct .mp4 link</li>
      <li>Connect a Handy device and control it automatically in sync with the script</li>
      <li>Play from your personal library or a playlist queue — no account needed for the player</li>
    </ul>
  </section>
  <section aria-label="Supported sources">
    <h2>Supported video sources</h2>
    <ul>
      <li>Local video files (MP4, WebM, MOV)</li>
      <li>Direct video URLs (.mp4, .webm)</li>
      <li>YouTube, Vimeo</li>
      <li>Pornhub, xVideos, xHamster, RedTube</li>
      <li>Any site supported by yt-dlp (signed-in users)</li>
    </ul>
  </section>
  <p><a href="${ORIGIN}/player">Open HapticOS Player — free, no account required</a></p>
</main>
`.trim();

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
      html = setJsonLd(html, {
        "@context": "https://schema.org",
        "@type": "WebApplication",
        "name": "HapticOS Player",
        "url": `${ORIGIN}/player`,
        "applicationCategory": "MultimediaApplication",
        "operatingSystem": "Web",
        "description": "Sync haptic scripts with any video and control your device in real time. Load a local file, paste a URL, or pick from your library — no account required.",
        "isAccessibleForFree": true,
      });
      html = setStaticBody(html, PLAYER_STATIC_BODY);
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
