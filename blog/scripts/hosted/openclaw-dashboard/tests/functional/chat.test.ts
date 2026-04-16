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

  // --- Concurrent task tests ---

  it("two messages submitted get separate taskIds", async () => {
    const app = getTestApp();
    const res1 = await app
      .post("/chat/message")
      .set("Cookie", cookie)
      .send({ message: "First message" });
    const res2 = await app
      .post("/chat/message")
      .set("Cookie", cookie)
      .send({ message: "Second message" });

    expect(res1.body.taskId).toMatch(/^tsk_/);
    expect(res2.body.taskId).toMatch(/^tsk_/);
    expect(res1.body.taskId).not.toBe(res2.body.taskId);
  });

  it("poll with taskId returns tasks array format", async () => {
    const app = getTestApp();
    const submitRes = await app
      .post("/chat/message")
      .set("Cookie", cookie)
      .send({ message: "Test message" });

    const pollRes = await app
      .get(`/chat/poll?taskId=${submitRes.body.taskId}`)
      .set("Cookie", cookie);

    expect(pollRes.status).toBe(200);
    expect(pollRes.body).toHaveProperty("tasks");
    expect(Array.isArray(pollRes.body.tasks)).toBe(true);
    expect(pollRes.body.tasks.length).toBe(1);
    expect(pollRes.body.tasks[0].taskId).toBe(submitRes.body.taskId);
  });

  it("poll without taskId returns backward-compat single format", async () => {
    const app = getTestApp();
    await app
      .post("/chat/message")
      .set("Cookie", cookie)
      .send({ message: "Test message" });

    const pollRes = await app.get("/chat/poll").set("Cookie", cookie);
    expect(pollRes.status).toBe(200);
    expect(pollRes.body).toHaveProperty("status");
    expect(pollRes.body).toHaveProperty("done");
    // Should NOT have tasks array in backward-compat mode
    expect(pollRes.body.tasks).toBeUndefined();
  });

  it("second submit does not clobber first task's pending state", async () => {
    const app = getTestApp();
    const res1 = await app
      .post("/chat/message")
      .set("Cookie", cookie)
      .send({ message: "First message" });
    const res2 = await app
      .post("/chat/message")
      .set("Cookie", cookie)
      .send({ message: "Second message" });

    // Poll for first task — should still exist
    const poll1 = await app
      .get(`/chat/poll?taskId=${res1.body.taskId}`)
      .set("Cookie", cookie);
    expect(poll1.body.tasks.length).toBe(1);
    expect(poll1.body.tasks[0].taskId).toBe(res1.body.taskId);

    // Poll for second task — should also exist
    const poll2 = await app
      .get(`/chat/poll?taskId=${res2.body.taskId}`)
      .set("Cookie", cookie);
    expect(poll2.body.tasks.length).toBe(1);
    expect(poll2.body.tasks[0].taskId).toBe(res2.body.taskId);
  });
});
