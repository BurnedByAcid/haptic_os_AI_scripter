import { copyFile, mkdir } from "fs/promises";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const corePkg = resolve(__dirname, "../node_modules/@ffmpeg/core/dist/esm");
const dest = resolve(__dirname, "../public/ffmpeg");

await mkdir(dest, { recursive: true });

for (const name of ["ffmpeg-core.js", "ffmpeg-core.wasm"]) {
  await copyFile(resolve(corePkg, name), resolve(dest, name));
  console.log(`Copied ${name} → public/ffmpeg/${name}`);
}

console.log("Done. public/ffmpeg/ is up to date.");
