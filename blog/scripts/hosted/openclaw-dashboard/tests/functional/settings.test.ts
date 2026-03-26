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

  it("GET /settings renders settings page", async () => {
    const app = getTestApp();
    const res = await app.get("/settings").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.text).toContain("settings");
  });

  it("POST /settings saves valid settings", async () => {
    const app = getTestApp();
    const res = await app
      .post("/settings")
      .set("Cookie", cookie)
      .send({
        provider: "anthropic",
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

  it("POST /settings encrypts API key", async () => {
    const app = getTestApp();
    await app
      .post("/settings")
      .set("Cookie", cookie)
      .send({
        provider: "anthropic",
        api_key: "sk-ant-test-key-12345",
        temperature: "1",
        max_tokens: "4096",
      });

    const stored = getSetting("anthropic_api_key");
    expect(stored).toBeDefined();
    // Should be encrypted (format: iv:tag:ciphertext, all hex)
    expect(stored).not.toBe("sk-ant-test-key-12345");
    expect(stored!.split(":")).toHaveLength(3);
  });

  it("POST /settings does not overwrite API key with masked value", async () => {
    const app = getTestApp();

    // Save a real key first
    await app
      .post("/settings")
      .set("Cookie", cookie)
      .send({
        provider: "anthropic",
        api_key: "sk-ant-real-key",
        temperature: "1",
        max_tokens: "4096",
      });

    const originalKey = getSetting("anthropic_api_key");

    // Submit with masked key (as browser would)
    await app
      .post("/settings")
      .set("Cookie", cookie)
      .send({
        provider: "anthropic",
        api_key: "••••••••••••",
        temperature: "1",
        max_tokens: "4096",
      });

    expect(getSetting("anthropic_api_key")).toBe(originalKey);
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
