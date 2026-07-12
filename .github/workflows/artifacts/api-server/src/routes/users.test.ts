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
    // DB: no existing clerk_id row → username free → insert succeeds
    mockPoolQuery
      .mockResolvedValueOnce({ rows: [] } as never)   // clerk_id existence check
      .mockResolvedValueOnce({ rows: [] } as never)   // username uniqueness check
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

  it("returns 200 and re-stamps metadata when DB row exists with matching username (partial-onboarding recovery)", async () => {
    // Simulates: DB insert succeeded but Clerk metadata write failed previously.
    mockPoolQuery
      .mockResolvedValueOnce({ rows: [{ username: "validuser" }] } as never); // clerk_id check → row found

    const app = buildApp();
    const res = await request(app)
      .post("/api/users/onboard")
      .send({ username: "validuser", ageVerified: true });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ username: "validuser" });
    // Must re-stamp the Clerk onboarded flag
    expect(mockUpdateUserMetadata).toHaveBeenCalledWith("user_test123", {
      publicMetadata: { onboarded: true },
    });
    // Should not attempt another INSERT — only one DB query (the clerk_id lookup)
    expect(mockPoolQuery).toHaveBeenCalledTimes(1);
  });

  it("returns 409 when the existing DB row has a different username than submitted", async () => {
    mockPoolQuery
      .mockResolvedValueOnce({ rows: [{ username: "other_name" }] } as never); // clerk_id check → row found with different username

    const app = buildApp();
    const res = await request(app)
      .post("/api/users/onboard")
      .send({ username: "validuser", ageVerified: true });

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: expect.stringContaining("different username") });
    expect(mockUpdateUserMetadata).not.toHaveBeenCalled();
  });

  it("returns 409 when the username is taken by another user", async () => {
    mockPoolQuery
      .mockResolvedValueOnce({ rows: [] } as never)            // clerk_id check → no row for this user
      .mockResolvedValueOnce({ rows: [{ }] } as never);        // username uniqueness → taken

    const app = buildApp();
    const res = await request(app)
      .post("/api/users/onboard")
      .send({ username: "takenuser", ageVerified: true });

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: expect.stringContaining("already taken") });
    expect(mockUpdateUserMetadata).not.toHaveBeenCalled();
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
