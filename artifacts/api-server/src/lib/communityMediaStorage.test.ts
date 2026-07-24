import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "events";

// ── Mocks (must be hoisted before the module under test is imported) ──────────

vi.mock("../lib/hapticaiStorage", () => ({
  gcsClient: { bucket: vi.fn() },
}));

vi.mock("../lib/db", () => ({
  pool: { query: vi.fn(), connect: vi.fn() },
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
const mockPoolConnect = vi.mocked(pool.connect);
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

/**
 * Create a mock Postgres client that handles the advisory-lock transaction:
 *   BEGIN → pg_advisory_xact_lock → SUM cap check → UPDATE status → COMMIT
 *
 * `reservedBytes` controls the value returned by the SUM cap check query.
 * Default 0 means "plenty of headroom → proceed with upload".
 */
function makeClientMock(reservedBytes = 0) {
  const clientQuery = vi.fn()
    .mockResolvedValueOnce({ rows: [] })                                        // BEGIN
    .mockResolvedValueOnce({ rows: [] })                                        // pg_advisory_xact_lock
    .mockResolvedValueOnce({ rows: [{ reserved: String(reservedBytes) }] })     // SUM cap check
    .mockResolvedValueOnce({ rows: [] })                                        // UPDATE status
    .mockResolvedValueOnce({ rows: [] });                                       // COMMIT
  return { query: clientQuery, release: vi.fn() };
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
    const client = makeClientMock(0);
    mockPoolConnect.mockResolvedValue(client as any);

    const writeStream = makeFakeWriteStream();
    const fakeFile = makeFakeFile(writeStream);
    const fakeBucket = { file: vi.fn().mockReturnValue(fakeFile) };
    mockGcsClient.bucket.mockReturnValue(fakeBucket as any);

    const fakeRes = makeFakeResponse(200, { "content-type": "video/mp4" });
    setupHttpsRequest(fakeRes);

    // Script exists in DB → UPDATE to 'cached' succeeds.
    mockPoolQuery
      .mockResolvedValueOnce({ rows: [{ id: SCRIPT_ID }] } as any) // SELECT id
      .mockResolvedValueOnce({ rows: [] } as any);                  // UPDATE to 'cached'

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

    // Transaction reserved slot as 'uploading'.
    const uploadingCall = (client.query.mock.calls as any[][]).find(
      (c) => typeof c[0] === "string" && (c[0] as string).includes("cache_status = 'uploading'"),
    );
    expect(uploadingCall).toBeDefined();

    // DB updated to 'cached' with storage key and byte count via pool.query.
    const updateCall = mockPoolQuery.mock.calls.find(
      (c) => typeof c[0] === "string" && (c[0] as string).includes("cache_status = 'cached'"),
    );
    expect(updateCall).toBeDefined();
    expect(updateCall![1]).toEqual([STORAGE_KEY, 256, SCRIPT_ID]);
  });

  it("upstream HTTP error: marks cache_status = failed without touching GCS", async () => {
    const client = makeClientMock(0);
    mockPoolConnect.mockResolvedValue(client as any);

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
    const client = makeClientMock(0);
    mockPoolConnect.mockResolvedValue(client as any);

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
    const client = makeClientMock(0);
    mockPoolConnect.mockResolvedValue(client as any);

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

  it("cap check exceeded: marks cache_status = skipped and skips upload", async () => {
    // Report reserved bytes at the cap so adding VIDEO_MAX_BYTES more would exceed it.
    const capBytes = 100 * 1024 * 1024 * 1024; // 100 GB default
    const client = makeClientMock(capBytes); // reserved = full cap → any new upload would exceed
    mockPoolConnect.mockResolvedValue(client as any);

    const fakeFile = { createWriteStream: vi.fn() };
    const fakeBucket = { file: vi.fn().mockReturnValue(fakeFile) };
    mockGcsClient.bucket.mockReturnValue(fakeBucket as any);

    mockPoolQuery.mockResolvedValue({ rows: [] } as any);

    await cacheVideoInBackground(SCRIPT_ID, VIDEO_URL);

    // The transaction should have committed a 'skipped' update, not 'uploading'.
    const skippedCall = (client.query.mock.calls as any[][]).find(
      (c) => typeof c[0] === "string" && (c[0] as string).includes("cache_status = 'skipped'"),
    );
    expect(skippedCall).toBeDefined();

    // No GCS interaction.
    expect(fakeFile.createWriteStream).not.toHaveBeenCalled();

    // No pool.query UPDATE to 'failed' — early return path.
    const failedCall = mockPoolQuery.mock.calls.find(
      (c) => typeof c[0] === "string" && (c[0] as string).includes("cache_status = 'failed'"),
    );
    expect(failedCall).toBeUndefined();
  });

  it("concurrent cap reservation: second upload sees in-progress slot and is skipped", async () => {
    // Simulate: one upload already in progress (counted as VIDEO_MAX_BYTES).
    // If the cap is just above VIDEO_MAX_BYTES, the second caller's check
    // (currentReserved + VIDEO_MAX_BYTES > cap) should fail.
    const capBytes = 100 * 1024 * 1024 * 1024; // 100 GB default
    // Reserved = cap - 1 byte → adding VIDEO_MAX_BYTES pushes it over.
    const client = makeClientMock(capBytes - 1);
    mockPoolConnect.mockResolvedValue(client as any);

    const fakeFile = { createWriteStream: vi.fn() };
    const fakeBucket = { file: vi.fn().mockReturnValue(fakeFile) };
    mockGcsClient.bucket.mockReturnValue(fakeBucket as any);

    mockPoolQuery.mockResolvedValue({ rows: [] } as any);

    await cacheVideoInBackground(SCRIPT_ID, VIDEO_URL);

    const skippedCall = (client.query.mock.calls as any[][]).find(
      (c) => typeof c[0] === "string" && (c[0] as string).includes("cache_status = 'skipped'"),
    );
    expect(skippedCall).toBeDefined();
    expect(fakeFile.createWriteStream).not.toHaveBeenCalled();
  });

  it("two simultaneous calls near cap boundary: exactly one proceeds, the other is skipped, cap is never exceeded", async () => {
    // Set cap to just below 2 × VIDEO_MAX_BYTES: headroom for exactly one upload.
    //
    // This test uses a SHARED STATEFUL mock so that the reserved-bytes value seen
    // by each caller is derived from what the other caller has actually committed —
    // not from a hardcoded constant.  This makes the test sensitive to the advisory
    // lock: if pg_advisory_xact_lock is removed, caller B runs its SUM query before
    // caller A commits, sees 0 bytes, and also marks itself 'uploading', causing the
    // `callerBFinalStatus === 'skipped'` assertion to fail.
    const cap = 2 * VIDEO_MAX_BYTES - 1;
    process.env.COMMUNITY_CACHE_MAX_TOTAL_BYTES = String(cap);

    const SCRIPT_ID_A = 201;
    const SCRIPT_ID_B = 202;

    // ── Shared DB state ───────────────────────────────────────────────────────
    // Tracks how many bytes have been committed (i.e. post-COMMIT) across all
    // concurrent callers.  This mirrors what Postgres sees after the lock holder
    // commits its UPDATE and before the next waiter sees the SUM result.
    let committedReservedBytes = 0;

    // ── Advisory-lock simulation ──────────────────────────────────────────────
    // The lock serialises callers: B's lock call returns only after A's COMMIT.
    // This is exactly what pg_advisory_xact_lock achieves in production.
    let lockHeld = false;
    const lockWaiters: Array<() => void> = [];

    function acquireLock(): Promise<void> {
      if (!lockHeld) {
        lockHeld = true;
        return Promise.resolve();
      }
      return new Promise<void>((resolve) => lockWaiters.push(resolve));
    }

    function releaseLock(): void {
      const next = lockWaiters.shift();
      if (next) {
        // next caller inherits the lock
        next();
      } else {
        lockHeld = false;
      }
    }

    // ── Per-caller status tracking ────────────────────────────────────────────
    let callerAFinalStatus: string | null = null;
    let callerBFinalStatus: string | null = null;

    function makeStatefulClient(
      callerLabel: "A" | "B",
      setFinalStatus: (s: string) => void,
    ) {
      let pendingUploading = false;

      return {
        query: vi.fn(async (sql: string) => {
          if (sql === "BEGIN") return { rows: [] };

          if (sql.includes("pg_advisory_xact_lock")) {
            // Block until the previous lock holder commits.
            await acquireLock();
            return { rows: [] };
          }

          if (sql.includes("COALESCE(SUM")) {
            // Return the bytes that have been committed by prior callers.
            return { rows: [{ reserved: String(committedReservedBytes) }] };
          }

          if (sql.includes("SET cache_status = 'uploading'")) {
            pendingUploading = true;
            setFinalStatus("uploading");
            return { rows: [] };
          }

          if (sql.includes("SET cache_status = 'skipped'")) {
            setFinalStatus("skipped");
            return { rows: [] };
          }

          if (sql === "COMMIT") {
            // Commit the reserved slot so subsequent callers see it in their SUM.
            if (pendingUploading) {
              committedReservedBytes += VIDEO_MAX_BYTES;
              pendingUploading = false;
            }
            releaseLock();
            return { rows: [] };
          }

          if (sql === "ROLLBACK") {
            releaseLock();
            return { rows: [] };
          }

          return { rows: [] };
        }),
        release: vi.fn(),
      };
    }

    const clientA = makeStatefulClient("A", (s) => { callerAFinalStatus = s; });
    const clientB = makeStatefulClient("B", (s) => { callerBFinalStatus = s; });

    mockPoolConnect
      .mockResolvedValueOnce(clientA as any)
      .mockResolvedValueOnce(clientB as any);

    // GCS – only caller A should reach this.
    const writeStreamA = makeFakeWriteStream();
    const fakeFileA = makeFakeFile(writeStreamA);
    const fakeBucket = { file: vi.fn().mockReturnValue(fakeFileA) };
    mockGcsClient.bucket.mockReturnValue(fakeBucket as any);

    // pool.query for caller A's post-transaction steps: SELECT id + UPDATE to 'cached'.
    mockPoolQuery
      .mockResolvedValueOnce({ rows: [{ id: SCRIPT_ID_A }] } as any)
      .mockResolvedValueOnce({ rows: [] } as any);

    const fakeResA = makeFakeResponse(200, { "content-type": "video/mp4" });
    setupHttpsRequest(fakeResA);

    // Launch both calls simultaneously.
    const promiseA = cacheVideoInBackground(SCRIPT_ID_A, "https://example.com/video-a.mp4");
    const promiseB = cacheVideoInBackground(SCRIPT_ID_B, "https://example.com/video-b.mp4");

    // Drain the microtask queue so both callers complete their advisory-lock
    // transactions before we drive caller A's upload stream to completion.
    await new Promise((r) => setImmediate(r));
    fakeResA.emit("data", Buffer.alloc(512));
    fakeResA.emit("end");

    await Promise.all([promiseA, promiseB]);

    delete process.env.COMMUNITY_CACHE_MAX_TOTAL_BYTES;

    // ── Verify caller A proceeded ─────────────────────────────────────────────

    expect(callerAFinalStatus, "caller A should reserve an uploading slot").toBe("uploading");

    const cachedCall = mockPoolQuery.mock.calls.find(
      (c) => typeof c[0] === "string" && (c[0] as string).includes("cache_status = 'cached'"),
    );
    expect(cachedCall, "caller A should complete and be marked cached").toBeDefined();

    // ── Verify caller B was skipped ───────────────────────────────────────────
    // With the advisory lock in place, caller B's SUM query runs after caller A
    // commits, so B sees committedReservedBytes = VIDEO_MAX_BYTES and is skipped.
    // Without the lock, B's SUM could run before A commits (seeing 0 bytes) and
    // B would also mark itself 'uploading', failing this assertion.
    expect(callerBFinalStatus, "caller B should be skipped — advisory lock must serialise callers").toBe("skipped");

    // ── Verify GCS was written exactly once ───────────────────────────────────

    expect(fakeBucket.file).toHaveBeenCalledTimes(1);
    expect(fakeBucket.file).toHaveBeenCalledWith(storageKeyForScript(SCRIPT_ID_A));

    // ── Verify neither call errored ───────────────────────────────────────────

    const failedCalls = mockPoolQuery.mock.calls.filter(
      (c) => typeof c[0] === "string" && (c[0] as string).includes("cache_status = 'failed'"),
    );
    expect(failedCalls, "neither call should be marked failed").toHaveLength(0);

    // ── Verify total reserved + cached bytes never exceeded cap ───────────────

    // committedReservedBytes is VIDEO_MAX_BYTES (A's slot); B contributed 0.
    // Actual upload was 512 bytes, well under the per-file cap.
    expect(committedReservedBytes, "only one upload slot should be committed").toBe(VIDEO_MAX_BYTES);
    expect(committedReservedBytes).toBeLessThanOrEqual(cap);
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
