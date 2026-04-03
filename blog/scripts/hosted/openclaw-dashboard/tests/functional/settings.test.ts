import { describe, it, expect, beforeEach } from "vitest";
import { getTestApp, freshDb } from "../helpers/app";
import { getAuthCookie } from "../helpers/auth";
import { getSetting } from "../../src/services/db";

describe("Settings", () => {
  let cookie: string;

  beforeEach(() => {
    freshDb();
    cookie = getAuthCookie();
  });

  it("GET /settings redirects to integrations", async () => {
    const app = getTestApp();
    const res = await app.get("/settings").set("Cookie", cookie);
    expect(res.status).toBe(302);
  });

  it("GET /settings?tab=details renders details page", async () => {
    const app = getTestApp();
    const res = await app.get("/settings?tab=details").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.text).toContain("Details");
  });

  it("POST /settings saves valid settings", async () => {
    const app = getTestApp();
    const res = await app
      .post("/settings")
      .set("Cookie", cookie)
      .send({
        model: "claude-sonnet-4-6",
        temperature: "0.5",
        max_tokens: "8192",
        system_prompt: "You are a helpful assistant.",
      });
    expect(res.status).toBe(303);
    expect(res.headers.location).toContain("Settings+saved");

    expect(getSetting("model")).toBe("claude-sonnet-4-6");
    expect(getSetting("temperature")).toBe("0.5");
    expect(getSetting("max_tokens")).toBe("8192");
    expect(getSetting("system_prompt")).toBe("You are a helpful assistant.");
  });

  it("GET /settings/debug returns JSON", async () => {
    const app = getTestApp();
    const res = await app.get("/settings/debug").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("memories");
    expect(res.body).toHaveProperty("context");
    expect(res.body).toHaveProperty("scheduled_jobs");
  });
});
