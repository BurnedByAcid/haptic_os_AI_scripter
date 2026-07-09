import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// ── Mocks must be declared before the module under test is imported ──────────

vi.mock("@clerk/express", () => ({
  getAuth: vi.fn(),
  clerkClient: {
    users: {
      updateUserMetadata: vi.fn().mockResolvedValue({}),
    },
  },
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
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

import { getAuth, clerkClient } from "@clerk/express";
import { pool } from "../lib/db";
import usersRouter from "./users";

const mockGetAuth = vi.mocked(getAuth);
const mockPoolQuery = vi.mocked(pool.query);
const mockUpdateUserMetadata = vi.mocked(clerkClient.users.updateUserMetadata);

// ── Helpers ──────────────────────────────────────────────────────────────────

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api", usersRouter);
  return app;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("POST /api/users/onboard — age verification guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: authenticated user
    mockGetAuth.mockReturnValue({ userId: "user_test123" } as ReturnType<typeof getAuth>);
  });

  it("returns 400 when ageVerified is missing", async () => {
    const app = buildApp();
    const res = await request(app)
      .post("/api/users/onboard")
      .send({ username: "validuser" });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: expect.stringContaining("Age verification") });
    expect(mockPoolQuery).not.toHaveBeenCalled();
  });

  it("returns 400 when ageVerified is false", async () => {
    const app = buildApp();
    const res = await request(app)
      .post("/api/users/onboard")
      .send({ username: "validuser", ageVerified: false });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: expect.stringContaining("Age verification") });
    expect(mockPoolQuery).not.toHaveBeenCalled();
  });

  it("returns 400 when ageVerified is a truthy string (not strict boolean true)", async () => {
    const app = buildApp();
    const res = await request(app)
      .post("/api/users/onboard")
      .send({ username: "validuser", ageVerified: "true" });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: expect.stringContaining("Age verification") });
    expect(mockPoolQuery).not.toHaveBeenCalled();
  });

  it("returns 400 when ageVerified is 1 (truthy number, not boolean true)", async () => {
    const app = buildApp();
    const res = await request(app)
      .post("/api/users/onboard")
      .send({ username: "validuser", ageVerified: 1 });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: expect.stringContaining("Age verification") });
    expect(mockPoolQuery).not.toHaveBeenCalled();
  });

  it("proceeds past age check when ageVerified is true (happy path)", async () => {
    // DB: no existing username, no existing user → insert succeeds
    mockPoolQuery
      .mockResolvedValueOnce({ rows: [] } as never)   // username uniqueness check
      .mockResolvedValueOnce({ rows: [] } as never)   // already-onboarded check
      .mockResolvedValueOnce({ rows: [] } as never);  // INSERT

    const app = buildApp();
    const res = await request(app)
      .post("/api/users/onboard")
      .send({ username: "validuser", ageVerified: true });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ username: "validuser" });
    expect(mockUpdateUserMetadata).toHaveBeenCalledWith("user_test123", {
      publicMetadata: { onboarded: true },
    });
  });

  it("returns 401 when not authenticated, regardless of ageVerified", async () => {
    mockGetAuth.mockReturnValue({ userId: null } as ReturnType<typeof getAuth>);

    const app = buildApp();
    const res = await request(app)
      .post("/api/users/onboard")
      .send({ username: "validuser", ageVerified: true });

    expect(res.status).toBe(401);
    expect(mockPoolQuery).not.toHaveBeenCalled();
  });
});
