import { describe, it, expect, beforeEach } from "vitest";
import { getTestApp, freshDb } from "../helpers/app";
import { getAuthCookie } from "../helpers/auth";

describe("Tasks", () => {
  let cookie: string;

  beforeEach(() => {
    freshDb();
    cookie = getAuthCookie();
  });

  it("GET /tasks renders tasks page", async () => {
    const app = getTestApp();
    const res = await app.get("/tasks").set("Cookie", cookie);
    expect(res.status).toBe(200);
  });

  it("GET /tasks/api returns paginated JSON", async () => {
    const app = getTestApp();
    const res = await app.get("/tasks/api").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("tasks");
    expect(res.body).toHaveProperty("page", 1);
    expect(res.body).toHaveProperty("totalPages");
    expect(res.body).toHaveProperty("total");
    expect(Array.isArray(res.body.tasks)).toBe(true);
  });

  it("GET /tasks/:taskId/api returns 404 for nonexistent task", async () => {
    const app = getTestApp();
    const res = await app.get("/tasks/tsk_000000000000/api").set("Cookie", cookie);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Task not found");
  });
});
