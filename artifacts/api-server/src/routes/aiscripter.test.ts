import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  beforeAll,
  afterAll,
  afterEach,
} from "vitest";
import express from "express";
import request from "supertest";

// ── Mocks must be declared before the module under test is imported ──────────

vi.mock("@clerk/express", () => ({
  getAuth: vi.fn(),
  clerkClient: {
    users: {
      getUser: vi.fn(),
      updateUserMetadata: vi.fn().mockResolvedValue({}),
    },
  },
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock("../lib/getPlan", () => ({
  getPlan: vi.fn(),
}));

vi.mock("../lib/db", () => ({
  pool: { query: vi.fn() },
}));

vi.mock("../lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// ── Now import mocked modules and the router ─────────────────────────────────

import { getAuth } from "@clerk/express";
import { getPlan } from "../lib/getPlan";
import aiscripterRouter from "./aiscripter";

const mockGetAuth = vi.mocked(getAuth);
const mockGetPlan = vi.mocked(getPlan);

// ── Helpers ──────────────────────────────────────────────────────────────────

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api", aiscripterRouter);
  return app;
}

// ── Env-var override setup ───────────────────────────────────────────────────
// Set download URL env vars so getEnvOverrideRelease() returns real data
// without hitting GitHub, keeping tests offline and deterministic.

const WIN_URL = "https://example.com/AIScripter-Setup.exe";
const MAC_URL = "https://example.com/AIScripter.dmg";
const LINUX_URL = "https://example.com/AIScripter.tar.gz";

beforeAll(() => {
  process.env.AISCRIPTER_DOWNLOAD_URL_WIN = WIN_URL;
  process.env.AISCRIPTER_DOWNLOAD_URL_MAC = MAC_URL;
  process.env.AISCRIPTER_DOWNLOAD_URL_LINUX = LINUX_URL;
  process.env.AISCRIPTER_VERSION = "v1.2.3";
});

afterAll(() => {
  delete process.env.AISCRIPTER_DOWNLOAD_URL_WIN;
  delete process.env.AISCRIPTER_DOWNLOAD_URL_MAC;
  delete process.env.AISCRIPTER_DOWNLOAD_URL_LINUX;
  delete process.env.AISCRIPTER_VERSION;
});

/** Assert no upstream/GitHub URL leaks anywhere in the response. */
function expectNoUpstreamLeak(res: request.Response) {
  const serialized = JSON.stringify({
    headers: res.headers,
    body: res.body,
    text: res.text ?? "",
  });
  expect(serialized).not.toContain("github.com");
  expect(serialized).not.toContain("example.com");
  expect(res.headers.location).toBeUndefined();
}

// ── Tests: GET /api/aiscripter/release/download ───────────────────────────────

describe("GET /api/aiscripter/release/download — auth and plan gating", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when the request is unauthenticated", async () => {
    mockGetAuth.mockReturnValue({ userId: null } as ReturnType<typeof getAuth>);

    const app = buildApp();
    const res = await request(app).get(
      "/api/aiscripter/release/download?platform=windows",
    );

    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ error: expect.any(String) });
    expect(mockGetPlan).not.toHaveBeenCalled();
  });

  it("returns 403 when the user is on the free plan", async () => {
    mockGetAuth.mockReturnValue({
      userId: "user_free",
    } as ReturnType<typeof getAuth>);
    mockGetPlan.mockResolvedValue("free");

    const app = buildApp();
    const res = await request(app).get(
      "/api/aiscripter/release/download?platform=windows",
    );

    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ error: expect.any(String) });
    expect(res.body).toHaveProperty("upgradeUrl");
  });

  it("returns a same-origin proxied path (not the upstream URL) for windows", async () => {
    mockGetAuth.mockReturnValue({
      userId: "user_sub",
    } as ReturnType<typeof getAuth>);
    mockGetPlan.mockResolvedValue("subscriber");

    const app = buildApp();
    const res = await request(app).get(
      "/api/aiscripter/release/download?platform=windows",
    );

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      url: "/api/aiscripter/release?platform=windows",
      tag: "v1.2.3",
      filename: "AIScripter-Setup.exe",
    });
    expectNoUpstreamLeak(res);
  });

  it("returns a same-origin proxied path for macos", async () => {
    mockGetAuth.mockReturnValue({
      userId: "user_sub",
    } as ReturnType<typeof getAuth>);
    mockGetPlan.mockResolvedValue("subscriber");

    const app = buildApp();
    const res = await request(app).get(
      "/api/aiscripter/release/download?platform=macos",
    );

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      url: "/api/aiscripter/release?platform=macos",
      tag: "v1.2.3",
      filename: "AIScripter.dmg",
    });
    expectNoUpstreamLeak(res);
  });

  it("returns a same-origin proxied path for linux", async () => {
    mockGetAuth.mockReturnValue({
      userId: "user_sub",
    } as ReturnType<typeof getAuth>);
    mockGetPlan.mockResolvedValue("subscriber");

    const app = buildApp();
    const res = await request(app).get(
      "/api/aiscripter/release/download?platform=linux",
    );

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      url: "/api/aiscripter/release?platform=linux",
      tag: "v1.2.3",
      filename: "AIScripter.tar.gz",
    });
    expectNoUpstreamLeak(res);
  });

  it("returns a proxied path for an admin (admin satisfies subscriber gate)", async () => {
    mockGetAuth.mockReturnValue({
      userId: "user_admin",
    } as ReturnType<typeof getAuth>);
    mockGetPlan.mockResolvedValue("admin");

    const app = buildApp();
    const res = await request(app).get(
      "/api/aiscripter/release/download?platform=windows",
    );

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      url: "/api/aiscripter/release?platform=windows",
    });
    expectNoUpstreamLeak(res);
  });
});

describe("GET /api/aiscripter/release/download — platform validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAuth.mockReturnValue({
      userId: "user_sub",
    } as ReturnType<typeof getAuth>);
    mockGetPlan.mockResolvedValue("subscriber");
  });

  it("returns 400 when platform query param is missing", async () => {
    const app = buildApp();
    const res = await request(app).get("/api/aiscripter/release/download");

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: expect.stringContaining("platform") });
  });

  it("returns 400 for an unknown platform value", async () => {
    const app = buildApp();
    const res = await request(app).get(
      "/api/aiscripter/release/download?platform=beos",
    );

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: expect.stringContaining("platform") });
  });

  it("returns 400 for an empty platform string", async () => {
    const app = buildApp();
    const res = await request(app).get(
      "/api/aiscripter/release/download?platform=",
    );

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: expect.stringContaining("platform") });
  });

  it("accepts platform values case-insensitively (WINDOWS → windows)", async () => {
    const app = buildApp();
    const res = await request(app).get(
      "/api/aiscripter/release/download?platform=WINDOWS",
    );

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      url: "/api/aiscripter/release?platform=windows",
    });
    expectNoUpstreamLeak(res);
  });
});

// ── Tests: GET /api/aiscripter/release (metadata + proxied streaming) ─────────

describe("GET /api/aiscripter/release — auth and plan gating", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when the request is unauthenticated", async () => {
    mockGetAuth.mockReturnValue({ userId: null } as ReturnType<typeof getAuth>);

    const app = buildApp();
    const res = await request(app).get("/api/aiscripter/release");

    expect(res.status).toBe(401);
    expect(mockGetPlan).not.toHaveBeenCalled();
  });

  it("returns 403 when the user is on the free plan", async () => {
    mockGetAuth.mockReturnValue({
      userId: "user_free",
    } as ReturnType<typeof getAuth>);
    mockGetPlan.mockResolvedValue("free");

    const app = buildApp();
    const res = await request(app).get("/api/aiscripter/release");

    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ error: expect.any(String) });
  });

  it("returns 200 with release metadata for a subscriber (no platform param)", async () => {
    mockGetAuth.mockReturnValue({
      userId: "user_sub",
    } as ReturnType<typeof getAuth>);
    mockGetPlan.mockResolvedValue("subscriber");

    const app = buildApp();
    const res = await request(app).get("/api/aiscripter/release");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      tag: "v1.2.3",
      sizeBytes: expect.any(Number),
      platforms: {
        windows: true,
        macos: true,
        linux: true,
      },
    });
    expectNoUpstreamLeak(res);
  });

  it("returns 400 for an invalid platform on the release endpoint", async () => {
    mockGetAuth.mockReturnValue({
      userId: "user_sub",
    } as ReturnType<typeof getAuth>);
    mockGetPlan.mockResolvedValue("subscriber");

    const app = buildApp();
    const res = await request(app).get(
      "/api/aiscripter/release?platform=amiga",
    );

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: expect.stringContaining("platform") });
  });
});

describe("GET /api/aiscripter/release?platform= — proxied streaming download", () => {
  const originalFetch = global.fetch;
  const BINARY = Buffer.from("fake-installer-bytes-0123456789");

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAuth.mockReturnValue({
      userId: "user_sub",
    } as ReturnType<typeof getAuth>);
    mockGetPlan.mockResolvedValue("subscriber");
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("streams the installer binary with attachment headers and no redirect", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(BINARY, {
        status: 200,
        headers: {
          "content-type": "application/octet-stream",
          "content-length": String(BINARY.length),
        },
      }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    const app = buildApp();
    const res = await request(app)
      .get("/api/aiscripter/release?platform=windows")
      .redirects(0)
      .buffer(true)
      .parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on("data", (c: Buffer) => chunks.push(c));
        response.on("end", () => callback(null, Buffer.concat(chunks)));
      });

    expect(res.status).toBe(200);
    expect(res.headers["content-disposition"]).toBe(
      'attachment; filename="AIScripter-Setup.exe"',
    );
    expect(res.headers["content-type"]).toContain("application/octet-stream");
    expect(res.headers["content-length"]).toBe(String(BINARY.length));
    expect(res.headers.location).toBeUndefined();
    expect(Buffer.compare(res.body as Buffer, BINARY)).toBe(0);

    // The upstream URL is only used server-side.
    expect(fetchMock).toHaveBeenCalledWith(WIN_URL, expect.any(Object));
  });

  it("returns 502 with an explicit error when the upstream fetch fails", async () => {
    global.fetch = vi
      .fn()
      .mockRejectedValue(new Error("network down")) as unknown as typeof fetch;

    const app = buildApp();
    const res = await request(app).get(
      "/api/aiscripter/release?platform=windows",
    );

    expect(res.status).toBe(502);
    expect(res.body).toMatchObject({ error: expect.any(String) });
    expectNoUpstreamLeak(res);
  });

  it("returns 502 when the upstream responds with an error status", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response("not found", { status: 404 }),
    ) as unknown as typeof fetch;

    const app = buildApp();
    const res = await request(app).get(
      "/api/aiscripter/release?platform=windows",
    );

    expect(res.status).toBe(502);
    expect(res.body).toMatchObject({ error: expect.any(String) });
    expectNoUpstreamLeak(res);
  });
});
