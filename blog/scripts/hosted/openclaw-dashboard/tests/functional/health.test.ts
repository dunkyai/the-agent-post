import { describe, it, expect, beforeEach } from "vitest";
import { getTestApp, freshDb } from "../helpers/app";

describe("Health endpoint", () => {
  beforeEach(() => freshDb());

  it("returns status ok", async () => {
    const app = getTestApp();
    const res = await app.get("/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(res.body.timestamp).toBeDefined();
  });
});
