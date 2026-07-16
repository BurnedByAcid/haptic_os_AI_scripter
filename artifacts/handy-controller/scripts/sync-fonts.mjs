/**
 * sync-fonts.mjs
 *
 * Downloads the Inter TTF font files needed by gen-og-image.mjs from the
 * official Inter GitHub release at a pinned version.  If the fonts are already
 * present at the correct version the script exits immediately so builds stay
 * fast.
 *
 * No extra npm packages are required – only Node.js built-ins (fetch, zlib).
 */

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'fs';
import { inflateRawSync } from 'zlib';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fontsDir  = path.join(__dirname, 'fonts');
const versionFile = path.join(fontsDir, '.inter-version');

/** ── Pinned Inter release ─────────────────────────────────────────── */
const INTER_VERSION = '4.0';
const RELEASE_ZIP_URL =
  `https://github.com/rsms/inter/releases/download/v${INTER_VERSION}/Inter-${INTER_VERSION}.zip`;

/**
 * Map from ZIP entry name → local file name.
 * In the Inter 4.0 release zip, static TTF fonts live under "extras/ttf/".
 */
const FONT_MAP = {
  'extras/ttf/Inter-Regular.ttf': 'Inter-Regular.ttf',
  'extras/ttf/Inter-Medium.ttf':  'Inter-Medium.ttf',
  'extras/ttf/Inter-Bold.ttf':    'Inter-Bold.ttf',
};

// ── Version check ───────────────────────────────────────────────────────────
const expectedFontFiles = Object.values(FONT_MAP).map(name => path.join(fontsDir, name));

function allFontsPresent() {
  return expectedFontFiles.every(f => existsSync(f) && statSync(f).size > 0);
}

if (existsSync(versionFile)) {
  const stored = readFileSync(versionFile, 'utf8').trim();
  if (stored === INTER_VERSION && allFontsPresent()) {
    console.log(`Inter fonts are already at v${INTER_VERSION} – nothing to do.`);
    process.exit(0);
  }
  if (stored === INTER_VERSION) {
    console.log(`Version matches but font files are missing or empty, re-downloading…`);
  } else {
    console.log(`Stored font version (${stored}) differs from pinned (${INTER_VERSION}), updating…`);
  }
} else {
  console.log(`Font version file not found, downloading Inter v${INTER_VERSION}…`);
}

mkdirSync(fontsDir, { recursive: true });

// ── Download ZIP ─────────────────────────────────────────────────────────────
console.log(`Fetching ${RELEASE_ZIP_URL}`);
const response = await fetch(RELEASE_ZIP_URL);
if (!response.ok) {
  throw new Error(`Failed to download Inter release: HTTP ${response.status}`);
}
const zipBuffer = Buffer.from(await response.arrayBuffer());
console.log(`Downloaded ${(zipBuffer.length / 1_048_576).toFixed(1)} MB`);

// ── Minimal ZIP parser ───────────────────────────────────────────────────────
// Locate End of Central Directory record (signature PK\x05\x06).
// We scan from the end of the buffer because the EOCD can be followed by
// a variable-length comment (max 65 535 bytes).
function findEOCD(buf) {
  const sig = 0x06054b50;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
    if (buf.readUInt32LE(i) === sig) return i;
  }
  throw new Error('ZIP: End of Central Directory record not found');
}

function readUInt16(buf, offset) { return buf.readUInt16LE(offset); }
function readUInt32(buf, offset) { return buf.readUInt32LE(offset); }

const eocdOffset = findEOCD(zipBuffer);
const cdOffset   = readUInt32(zipBuffer, eocdOffset + 16);
const cdSize     = readUInt32(zipBuffer, eocdOffset + 12);

// Parse Central Directory entries
const extracted = new Set();
let pos = cdOffset;
while (pos < cdOffset + cdSize) {
  if (readUInt32(zipBuffer, pos) !== 0x02014b50) break; // Central directory entry signature

  const compressionMethod = readUInt16(zipBuffer, pos + 10);
  const compressedSize    = readUInt32(zipBuffer, pos + 20);
  const uncompressedSize  = readUInt32(zipBuffer, pos + 24);
  const fileNameLen       = readUInt16(zipBuffer, pos + 28);
  const extraLen          = readUInt16(zipBuffer, pos + 30);
  const commentLen        = readUInt16(zipBuffer, pos + 32);
  const localHeaderOffset = readUInt32(zipBuffer, pos + 42);

  const entryName = zipBuffer.slice(pos + 46, pos + 46 + fileNameLen).toString('utf8');
  pos += 46 + fileNameLen + extraLen + commentLen;

  const destName = FONT_MAP[entryName];
  if (!destName) continue;

  // Read Local File Header to find actual data start
  const lfhPos       = localHeaderOffset;
  if (readUInt32(zipBuffer, lfhPos) !== 0x04034b50) {
    throw new Error(`ZIP: Invalid local file header for ${entryName}`);
  }
  const lfhFileNameLen = readUInt16(zipBuffer, lfhPos + 26);
  const lfhExtraLen    = readUInt16(zipBuffer, lfhPos + 28);
  const dataStart      = lfhPos + 30 + lfhFileNameLen + lfhExtraLen;
  const compressedData = zipBuffer.slice(dataStart, dataStart + compressedSize);

  let fileData;
  if (compressionMethod === 0) {
    fileData = compressedData;                  // stored (no compression)
  } else if (compressionMethod === 8) {
    fileData = inflateRawSync(compressedData);  // deflated
  } else {
    throw new Error(`ZIP: Unsupported compression method ${compressionMethod} for ${entryName}`);
  }

  if (fileData.length !== uncompressedSize) {
    throw new Error(`ZIP: Size mismatch for ${entryName} (expected ${uncompressedSize}, got ${fileData.length})`);
  }

  const destPath = path.join(fontsDir, destName);
  writeFileSync(destPath, fileData);
  console.log(`  Extracted → ${destName} (${(fileData.length / 1024).toFixed(0)} KB)`);
  extracted.add(destName);
}

// ── Verify all fonts were found ──────────────────────────────────────────────
const expected = new Set(Object.values(FONT_MAP));
for (const name of expected) {
  if (!extracted.has(name)) {
    throw new Error(`Font not found in ZIP: ${name}. The ZIP structure may have changed.`);
  }
}

// ── Write version marker ─────────────────────────────────────────────────────
writeFileSync(versionFile, INTER_VERSION + '\n');
console.log(`\nInter v${INTER_VERSION} fonts synced successfully.`);
