import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "events";

// ── Mocks (must be hoisted before the module under test is imported) ──────────

vi.mock("../lib/hapticaiStorage", () => ({
  gcsClient: { bucket: vi.fn() },
}));

vi.mock("../lib/db", () => ({
  pool: { query: vi.fn() },
}));

vi.mock("../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("dns", () => ({
  default: {
    promises: {
      lookup: vi.fn(),
    },
  },
}));

vi.mock("https", () => ({
  default: { request: vi.fn() },
}));

vi.mock("http", () => ({
  default: { request: vi.fn() },
}));

// ── Now import the mocked modules and the module under test ──────────────────

import { gcsClient } from "../lib/hapticaiStorage";
import { pool } from "../lib/db";
import dns from "dns";
import https from "https";
import {
  cacheVideoInBackground,
  deleteCachedVideo,
  storageKeyForScript,
} from "./communityMediaStorage";

const mockGcsClient = vi.mocked(gcsClient);
const mockPoolQuery = vi.mocked(pool.query);
const mockDnsLookup = vi.mocked(dns.promises.lookup);
const mockHttpsRequest = vi.mocked(https.request);

const VIDEO_MAX_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB

// ── Stream helpers ────────────────────────────────────────────────────────────

/**
 * Build a fake ClientRequest (return value of https.request).
 */
function makeFakeClientReq() {
  const ee = new EventEmitter();
  return Object.assign(ee, { end: vi.fn() });
}

/**
 * Build a fake IncomingMessage (the callback argument of https.request).
 * `pipe` is wired so that emitting "end" on the response triggers `finish` on
 * the supplied write-stream, which is what cacheVideoInBackground awaits.
 */
function makeFakeResponse(
  statusCode: number,
  headers: Record<string, string> = {},
): EventEmitter & {
  statusCode: number;
  headers: Record<string, string>;
  resume: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
  pipe: (dest: EventEmitter & { end?: () => void }) => void;
} {
  const ee = new EventEmitter() as any;
  ee.statusCode = statusCode;
  ee.headers = headers;
  ee.resume = vi.fn();
  ee.destroy = vi.fn();
  ee.pipe = (dest: EventEmitter & { end?: () => void }) => {
    ee.on("data", (chunk: unknown) => (dest as any).write?.(chunk));
    ee.on("end", () => dest.end?.());
    return dest;
  };
  return ee;
}

/**
 * Build a fake GCS writable stream returned by file.createWriteStream().
 * By default, calling `.end()` emits "finish" (simulating a successful upload).
 */
function makeFakeWriteStream() {
  const ee = new EventEmitter() as any;
  ee.write = vi.fn();
  ee.end = vi.fn(() => process.nextTick(() => ee.emit("finish")));
  ee.destroy = vi.fn((err?: Error) => {
    if (err) process.nextTick(() => ee.emit("error", err));
  });
  return ee;
}

/**
 * Build a fake GCS File object.
 */
function makeFakeFile(writeStream: ReturnType<typeof makeFakeWriteStream>) {
  return {
    createWriteStream: vi.fn(() => writeStream),
    exists: vi.fn().mockResolvedValue([true]),
    delete: vi.fn().mockResolvedValue(undefined),
    getMetadata: vi.fn().mockResolvedValue([{ contentType: "video/mp4", size: 1000 }]),
    createReadStream: vi.fn(),
  };
}

/**
 * Wire https.request so that calling `.end()` on the returned fake request
 * synchronously invokes the response callback with `fakeRes`.
 */
function setupHttpsRequest(fakeRes: ReturnType<typeof makeFakeResponse>) {
  mockHttpsRequest.mockImplementation(
    (_url: unknown, _opts: unknown, callback?: (res: any) => void) => {
      const fakeReq = makeFakeClientReq();
      const originalEnd = fakeReq.end as ReturnType<typeof vi.fn>;
      originalEnd.mockImplementation(() => {
        if (callback) callback(fakeRes);
      });
      return fakeReq as any;
    },
  );
}

// ── Shared setup ─────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();

  // DNS: always resolve to a public IP so the SSRF guard passes.
  mockDnsLookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }] as any);
});

// ── cacheVideoInBackground ────────────────────────────────────────────────────

describe("cacheVideoInBackground", () => {
  const SCRIPT_ID = 42;
  const VIDEO_URL = "https://example.com/video.mp4";
  const STORAGE_KEY = storageKeyForScript(SCRIPT_ID);

  it("caches successfully: streams data to GCS and marks cache_status = cached", async () => {
    const writeStream = makeFakeWriteStream();
    const fakeFile = makeFakeFile(writeStream);
    const fakeBucket = { file: vi.fn().mockReturnValue(fakeFile) };
    mockGcsClient.bucket.mockReturnValue(fakeBucket as any);

    const fakeRes = makeFakeResponse(200, { "content-type": "video/mp4" });
    setupHttpsRequest(fakeRes);

    // Script exists in DB → UPDATE to 'cached' succeeds.
    mockPoolQuery
      .mockResolvedValueOnce({ rows: [{ id: SCRIPT_ID }] } as any) // SELECT
      .mockResolvedValueOnce({ rows: [] } as any); // UPDATE

    const promise = cacheVideoInBackground(SCRIPT_ID, VIDEO_URL);

    // Emit a small data chunk then end the response.
    await new Promise((r) => setImmediate(r));
    fakeRes.emit("data", Buffer.alloc(256));
    fakeRes.emit("end");

    await promise;

    // GCS file created with correct key.
    expect(fakeBucket.file).toHaveBeenCalledWith(STORAGE_KEY);
    expect(fakeFile.createWriteStream).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: { contentType: "video/mp4" } }),
    );

    // DB updated to 'cached' with the storage key.
    const updateCall = mockPoolQuery.mock.calls.find(
      (c) => typeof c[0] === "string" && (c[0] as string).includes("cache_status = 'cached'"),
    );
    expect(updateCall).toBeDefined();
    expect(updateCall![1]).toEqual([STORAGE_KEY, SCRIPT_ID]);
  });

  it("upstream HTTP error: marks cache_status = failed without touching GCS", async () => {
    const writeStream = makeFakeWriteStream();
    const fakeFile = makeFakeFile(writeStream);
    const fakeBucket = { file: vi.fn().mockReturnValue(fakeFile) };
    mockGcsClient.bucket.mockReturnValue(fakeBucket as any);

    // Upstream returns 404.
    const fakeRes = makeFakeResponse(404);
    setupHttpsRequest(fakeRes);

    mockPoolQuery.mockResolvedValue({ rows: [] } as any);

    await cacheVideoInBackground(SCRIPT_ID, VIDEO_URL);

    const updateCall = mockPoolQuery.mock.calls.find(
      (c) => typeof c[0] === "string" && (c[0] as string).includes("cache_status = 'failed'"),
    );
    expect(updateCall).toBeDefined();
    expect(updateCall![1]).toEqual([SCRIPT_ID]);

    // No GCS write should have been attempted.
    expect(fakeFile.createWriteStream).not.toHaveBeenCalled();
  });

  it("file exceeds 2 GB: aborts upload and marks cache_status = failed", async () => {
    const writeStream = makeFakeWriteStream();
    const fakeFile = makeFakeFile(writeStream);
    const fakeBucket = { file: vi.fn().mockReturnValue(fakeFile) };
    mockGcsClient.bucket.mockReturnValue(fakeBucket as any);

    const fakeRes = makeFakeResponse(200, { "content-type": "video/mp4" });
    setupHttpsRequest(fakeRes);

    mockPoolQuery.mockResolvedValue({ rows: [] } as any);

    const promise = cacheVideoInBackground(SCRIPT_ID, VIDEO_URL);

    await new Promise((r) => setImmediate(r));

    // Emit a fake chunk whose .length exceeds the 2 GB cap.
    // We use a plain object so no real memory is allocated.
    fakeRes.emit("data", { length: VIDEO_MAX_BYTES + 1 });

    await promise;

    // writeStream.destroy must have been called to abort the upload.
    expect(writeStream.destroy).toHaveBeenCalledWith(expect.any(Error));

    const updateCall = mockPoolQuery.mock.calls.find(
      (c) => typeof c[0] === "string" && (c[0] as string).includes("cache_status = 'failed'"),
    );
    expect(updateCall).toBeDefined();
    expect(updateCall![1]).toEqual([SCRIPT_ID]);
  });

  it("GCS write failure: marks cache_status = failed", async () => {
    const writeStream = makeFakeWriteStream();
    // Override end() to emit an error instead of finish.
    writeStream.end.mockImplementation(() => {
      process.nextTick(() => writeStream.emit("error", new Error("GCS unavailable")));
    });

    const fakeFile = makeFakeFile(writeStream);
    const fakeBucket = { file: vi.fn().mockReturnValue(fakeFile) };
    mockGcsClient.bucket.mockReturnValue(fakeBucket as any);

    const fakeRes = makeFakeResponse(200, { "content-type": "video/mp4" });
    setupHttpsRequest(fakeRes);

    mockPoolQuery.mockResolvedValue({ rows: [] } as any);

    const promise = cacheVideoInBackground(SCRIPT_ID, VIDEO_URL);

    await new Promise((r) => setImmediate(r));
    fakeRes.emit("data", Buffer.alloc(64));
    fakeRes.emit("end");

    await promise;

    const updateCall = mockPoolQuery.mock.calls.find(
      (c) => typeof c[0] === "string" && (c[0] as string).includes("cache_status = 'failed'"),
    );
    expect(updateCall).toBeDefined();
    expect(updateCall![1]).toEqual([SCRIPT_ID]);
  });
});

// ── deleteCachedVideo ─────────────────────────────────────────────────────────

describe("deleteCachedVideo", () => {
  const SCRIPT_ID = 7;

  it("deletes the GCS object when it exists", async () => {
    const fakeFile = {
      exists: vi.fn().mockResolvedValue([true]),
      delete: vi.fn().mockResolvedValue(undefined),
    };
    const fakeBucket = { file: vi.fn().mockReturnValue(fakeFile) };
    mockGcsClient.bucket.mockReturnValue(fakeBucket as any);

    await deleteCachedVideo(SCRIPT_ID);

    expect(fakeFile.exists).toHaveBeenCalledOnce();
    expect(fakeFile.delete).toHaveBeenCalledOnce();
  });

  it("skips GCS delete when the object does not exist", async () => {
    const fakeFile = {
      exists: vi.fn().mockResolvedValue([false]),
      delete: vi.fn(),
    };
    const fakeBucket = { file: vi.fn().mockReturnValue(fakeFile) };
    mockGcsClient.bucket.mockReturnValue(fakeBucket as any);

    await deleteCachedVideo(SCRIPT_ID);

    expect(fakeFile.exists).toHaveBeenCalledOnce();
    expect(fakeFile.delete).not.toHaveBeenCalled();
  });

  it("swallows GCS errors and does not throw", async () => {
    const fakeFile = {
      exists: vi.fn().mockRejectedValue(new Error("GCS error")),
      delete: vi.fn(),
    };
    const fakeBucket = { file: vi.fn().mockReturnValue(fakeFile) };
    mockGcsClient.bucket.mockReturnValue(fakeBucket as any);

    await expect(deleteCachedVideo(SCRIPT_ID)).resolves.toBeUndefined();
  });
});
