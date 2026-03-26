import { describe, it, expect, beforeEach } from "vitest";
import { getTestApp, freshDb } from "../helpers/app";
import { getAuthCookie } from "../helpers/auth";
import { setSetting } from "../../src/services/db";

describe("Chat", () => {
  let cookie: string;

  beforeEach(() => {
    freshDb();
    cookie = getAuthCookie();
    // Fill context fields to bypass onboarding gate
    setSetting("context_company", "A test company that does test things");
    setSetting("context_user", "A test user who runs test things");
    setSetting("context_rules", "Some rules that are long enough to pass");
    setSetting("context_knowledge", "Some knowledge that is long enough to pass");
  });

  it("GET /chat renders chat page", async () => {
    const app = getTestApp();
    const res = await app.get("/chat").set("Cookie", cookie);
    expect(res.status).toBe(200);
  });

  it("POST /chat/message creates a task and returns taskId", async () => {
    const app = getTestApp();
    const res = await app
      .post("/chat/message")
      .set("Cookie", cookie)
      .send({ message: "Hello, agent!" });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.taskId).toBeDefined();
    expect(res.body.taskId).toMatch(/^tsk_/);
  });

  it("GET /chat/poll returns status", async () => {
    const app = getTestApp();
    const res = await app.get("/chat/poll").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("status");
    expect(res.body).toHaveProperty("done");
  });

  it("POST /chat/reset redirects back to chat", async () => {
    const app = getTestApp();
    const res = await app.post("/chat/reset").set("Cookie", cookie);
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe("/chat");
  });
});
