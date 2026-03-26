import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getTestApp, freshDb } from "../helpers/app";
import { getAuthCookie } from "../helpers/auth";

describe("Auth bypass protection", () => {
  beforeEach(() => freshDb());

  const protectedRoutes = [
    { method: "get" as const, path: "/" },
    { method: "get" as const, path: "/getting-started" },
    { method: "get" as const, path: "/settings" },
    { method: "get" as const, path: "/integrations" },
    { method: "get" as const, path: "/chat" },
    { method: "get" as const, path: "/jobs" },
    { method: "get" as const, path: "/tasks" },
    { method: "post" as const, path: "/getting-started" },
    { method: "post" as const, path: "/settings" },
    { method: "post" as const, path: "/chat/message" },
    { method: "post" as const, path: "/jobs" },
  ];

  for (const route of protectedRoutes) {
    it(`${route.method.toUpperCase()} ${route.path} redirects to /login without session`, async () => {
      const app = getTestApp();
      const res = await app[route.method](route.path);
      expect(res.status).toBe(302);
      expect(res.headers.location).toBe("/login");
    });
  }

  it("GET /login is accessible without session", async () => {
    const app = getTestApp();
    const res = await app.get("/login");
    expect(res.status).toBe(200);
  });

  it("GET /health is accessible without session", async () => {
    const app = getTestApp();
    const res = await app.get("/health");
    expect(res.status).toBe(200);
  });

  it("POST /webhook/email is accessible without session (auth via token)", async () => {
    const app = getTestApp();
    const res = await app
      .post("/webhook/email")
      .set("Authorization", `Bearer ${process.env.GATEWAY_TOKEN}`)
      .send({});
    // 200 = processed (no integration configured, but auth passed)
    expect(res.status).toBe(200);
  });

  it("rejects invalid session token", async () => {
    const app = getTestApp();
    const res = await app
      .get("/settings")
      .set("Cookie", "openclaw_session=invalid-token-that-does-not-exist");
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("/login");
  });

  it("accepts valid session token", async () => {
    const app = getTestApp();
    const cookie = getAuthCookie();
    const res = await app.get("/getting-started").set("Cookie", cookie);
    expect(res.status).toBe(200);
  });

  describe("SKIP_AUTH bypass", () => {
    const originalSkipAuth = process.env.SKIP_AUTH;

    afterEach(() => {
      if (originalSkipAuth === undefined) {
        delete process.env.SKIP_AUTH;
      } else {
        process.env.SKIP_AUTH = originalSkipAuth;
      }
    });

    it("allows access without session when SKIP_AUTH=true", async () => {
      process.env.SKIP_AUTH = "true";
      const app = getTestApp();
      const res = await app.get("/getting-started");
      expect(res.status).toBe(200);
    });
  });
});
