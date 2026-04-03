import { describe, it, expect, beforeEach } from "vitest";
import { getTestApp, freshDb } from "../helpers/app";

describe("Security headers", () => {
  beforeEach(() => freshDb());

  it("sets all security headers on responses", async () => {
    const app = getTestApp();
    const res = await app.get("/health");

    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-frame-options"]).toBe("DENY");
    expect(res.headers["x-xss-protection"]).toBe("1; mode=block");
    expect(res.headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(res.headers["strict-transport-security"]).toBe("max-age=31536000; includeSubDomains");
    expect(res.headers["permissions-policy"]).toBe("camera=(), microphone=(self), geolocation=()");
    expect(res.headers["content-security-policy"]).toContain("default-src 'self'");
  });

  it("does not expose x-powered-by", async () => {
    const app = getTestApp();
    const res = await app.get("/health");
    expect(res.headers["x-powered-by"]).toBeUndefined();
  });
});
