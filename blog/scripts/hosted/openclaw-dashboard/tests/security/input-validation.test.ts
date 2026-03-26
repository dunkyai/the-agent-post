import { describe, it, expect, beforeEach } from "vitest";
import { getTestApp, freshDb } from "../helpers/app";
import { getAuthCookie } from "../helpers/auth";

describe("Input validation", () => {
  let cookie: string;

  beforeEach(() => {
    freshDb();
    cookie = getAuthCookie();
  });

  it("rejects temperature > 2", async () => {
    const app = getTestApp();
    const res = await app
      .post("/settings")
      .set("Cookie", cookie)
      .send({ provider: "anthropic", temperature: "3", max_tokens: "4096" });
    expect(res.status).toBe(303);
    expect(res.headers.location).toContain("Temperature");
  });

  it("rejects temperature < 0", async () => {
    const app = getTestApp();
    const res = await app
      .post("/settings")
      .set("Cookie", cookie)
      .send({ provider: "anthropic", temperature: "-1", max_tokens: "4096" });
    expect(res.status).toBe(303);
    expect(res.headers.location).toContain("Temperature");
  });

  it("rejects max_tokens > 16384", async () => {
    const app = getTestApp();
    const res = await app
      .post("/settings")
      .set("Cookie", cookie)
      .send({ provider: "anthropic", temperature: "1", max_tokens: "99999" });
    expect(res.status).toBe(303);
    expect(res.headers.location).toContain("tokens");
  });

  it("rejects max_tokens < 1", async () => {
    const app = getTestApp();
    const res = await app
      .post("/settings")
      .set("Cookie", cookie)
      .send({ provider: "anthropic", temperature: "1", max_tokens: "0" });
    expect(res.status).toBe(303);
    expect(res.headers.location).toContain("tokens");
  });

  it("rejects empty chat message", async () => {
    const app = getTestApp();
    const res = await app
      .post("/chat/message")
      .set("Cookie", cookie)
      .send({ message: "" });
    expect(res.status).toBe(400);
  });

  it("rejects missing chat message", async () => {
    const app = getTestApp();
    const res = await app
      .post("/chat/message")
      .set("Cookie", cookie)
      .send({});
    expect(res.status).toBe(400);
  });

  it("accepts valid settings", async () => {
    const app = getTestApp();
    const res = await app
      .post("/settings")
      .set("Cookie", cookie)
      .send({ provider: "anthropic", temperature: "0.7", max_tokens: "4096" });
    expect(res.status).toBe(303);
    expect(res.headers.location).toContain("Settings+saved");
  });
});
