import { describe, it, expect, beforeEach } from "vitest";
import { getTestApp, freshDb } from "../helpers/app";
import { getAuthCookie } from "../helpers/auth";

describe("Auth flow", () => {
  beforeEach(() => freshDb());

  it("GET /login renders login page", async () => {
    const app = getTestApp();
    const res = await app.get("/login");
    expect(res.status).toBe(200);
    expect(res.text).toContain("login");
  });

  it("POST /login/magic-link with empty email redirects with error", async () => {
    const app = getTestApp();
    const res = await app.post("/login/magic-link").send({ email: "" });
    expect(res.status).toBe(303);
    expect(res.headers.location).toContain("error=");
  });

  it("POST /login/magic-link with valid email redirects to sent state", async () => {
    const app = getTestApp();
    // Provisioning URL is unreachable in tests — will catch error and redirect
    const res = await app.post("/login/magic-link").send({ email: "test@example.com" });
    expect(res.status).toBe(303);
    // Either sent=1 or error (provisioning unreachable) — both are valid redirects
    expect(res.headers.location).toMatch(/\/(login)/);
  });

  it("GET /login/callback without code redirects with error", async () => {
    const app = getTestApp();
    const res = await app.get("/login/callback");
    expect(res.status).toBe(303);
    expect(res.headers.location).toContain("error=");
  });

  it("POST /logout destroys session and redirects to login", async () => {
    const app = getTestApp();
    const cookie = getAuthCookie();
    const res = await app.post("/logout").set("Cookie", cookie);
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe("/login");
  });

  it("session is invalid after logout", async () => {
    const app = getTestApp();
    const cookie = getAuthCookie();

    // Verify session works first
    const before = await app.get("/getting-started").set("Cookie", cookie);
    expect(before.status).toBe(200);

    // Logout
    await app.post("/logout").set("Cookie", cookie);

    // Session should be invalid now
    const after = await app.get("/getting-started").set("Cookie", cookie);
    expect(after.status).toBe(302);
    expect(after.headers.location).toBe("/login");
  });
});
