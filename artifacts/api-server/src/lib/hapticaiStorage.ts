import { Storage } from "@google-cloud/storage";

const REPLIT_SIDECAR_ENDPOINT = "http://127.0.0.1:1106";

export const gcsClient = new Storage({
  credentials: {
    audience: "replit",
    subject_token_type: "access_token",
    token_url: `${REPLIT_SIDECAR_ENDPOINT}/token`,
    type: "external_account",
    credential_source: {
      url: `${REPLIT_SIDECAR_ENDPOINT}/credential`,
      format: {
        type: "json",
        subject_token_field_name: "access_token",
      },
    },
    universe_domain: "googleapis.com",
  },
  projectId: "",
});

/**
 * Resolve the GCS bucket name.
 * Prefers HAPTICAI_STORAGE_BUCKET (explicit, per task spec).
 * Falls back to the first path segment of PRIVATE_OBJECT_DIR (Replit Object
 * Storage convention) so the two setups are interoperable.
 */
function getBucketName(): string {
  const explicit = process.env.HAPTICAI_STORAGE_BUCKET?.trim();
  if (explicit) return explicit;

  const dir = process.env.PRIVATE_OBJECT_DIR?.trim() ?? "";
  if (dir) {
    const first = dir.replace(/^\//, "").split("/")[0];
    if (first) return first;
  }

  throw new Error(
    "Storage bucket not configured. Set HAPTICAI_STORAGE_BUCKET (or PRIVATE_OBJECT_DIR).",
  );
}

function storageKeyForPlatform(platform: string, version: string): string {
  const ext = platform === "mac" ? "dmg" : "exe";
  return `hapticai-releases/${platform}/${version}/HapticAI-Setup.${ext}`;
}

export async function uploadReleaseToGCS(
  platform: string,
  version: string,
  stream: NodeJS.ReadableStream,
  contentType: string,
): Promise<{ storageKey: string; sizeBytes: number }> {
  const bucketName = getBucketName();
  const storageKey = storageKeyForPlatform(platform, version);
  const bucket = gcsClient.bucket(bucketName);
  const file = bucket.file(storageKey);

  let sizeBytes = 0;
  await new Promise<void>((resolve, reject) => {
    const writeStream = file.createWriteStream({
      metadata: { contentType },
      resumable: false,
    });
    stream.on("data", (chunk: Buffer) => { sizeBytes += chunk.length; });
    stream.on("error", reject);
    writeStream.on("error", reject);
    writeStream.on("finish", resolve);
    stream.pipe(writeStream);
  });

  return { storageKey, sizeBytes };
}

export async function downloadReleaseFromGCS(
  storageKey: string,
  startOffset = 0,
  endOffset = -1,
): Promise<{ stream: NodeJS.ReadableStream; contentType: string; sizeBytes: number }> {
  const bucketName = getBucketName();
  const bucket = gcsClient.bucket(bucketName);
  const file = bucket.file(storageKey);

  const [exists] = await file.exists();
  if (!exists) throw new Error("Release file not found in storage");

  const [metadata] = await file.getMetadata();
  const contentType = (metadata.contentType as string) ?? "application/octet-stream";
  const sizeBytes = Number(metadata.size ?? 0);

  const streamOptions: { start?: number; end?: number } = {};
  if (startOffset > 0) streamOptions.start = startOffset;
  if (endOffset >= 0) streamOptions.end = endOffset;
  const stream = file.createReadStream(
    Object.keys(streamOptions).length > 0 ? streamOptions : {},
  );

  return { stream, contentType, sizeBytes };
}
