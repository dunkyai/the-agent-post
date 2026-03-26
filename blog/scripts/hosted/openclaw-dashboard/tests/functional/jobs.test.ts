import { describe, it, expect, beforeEach } from "vitest";
import { getTestApp, freshDb } from "../helpers/app";
import { getAuthCookie } from "../helpers/auth";
import { getAllScheduledJobs } from "../../src/services/db";

describe("Jobs CRUD", () => {
  let cookie: string;

  beforeEach(() => {
    freshDb();
    cookie = getAuthCookie();
  });

  it("GET /jobs renders jobs page", async () => {
    const app = getTestApp();
    const res = await app.get("/jobs").set("Cookie", cookie);
    expect(res.status).toBe(200);
  });

  it("GET /jobs/api returns JSON", async () => {
    const app = getTestApp();
    const res = await app.get("/jobs/api").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("jobs");
    expect(res.body).toHaveProperty("timezone");
  });

  it("POST /jobs creates a new job", async () => {
    const app = getTestApp();
    const res = await app
      .post("/jobs")
      .set("Cookie", cookie)
      .send({ name: "Test Job", schedule: "0 9 * * *", prompt: "Do something" });
    expect(res.status).toBe(303);
    expect(res.headers.location).toContain("Job+created");

    const jobs = getAllScheduledJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0].name).toBe("Test Job");
    expect(jobs[0].schedule).toBe("0 9 * * *");
    expect(jobs[0].prompt).toBe("Do something");
  });

  it("POST /jobs rejects invalid cron", async () => {
    const app = getTestApp();
    const res = await app
      .post("/jobs")
      .set("Cookie", cookie)
      .send({ name: "Bad Job", schedule: "not-a-cron", prompt: "test" });
    expect(res.status).toBe(303);
    expect(res.headers.location).toContain("Invalid+cron");
  });

  it("POST /jobs rejects empty fields", async () => {
    const app = getTestApp();
    const res = await app
      .post("/jobs")
      .set("Cookie", cookie)
      .send({ name: "", schedule: "0 9 * * *", prompt: "test" });
    expect(res.status).toBe(303);
    expect(res.headers.location).toContain("required");
  });

  it("POST /jobs/:id/toggle toggles job enabled state", async () => {
    const app = getTestApp();

    // Create a job
    await app
      .post("/jobs")
      .set("Cookie", cookie)
      .send({ name: "Toggle Job", schedule: "0 9 * * *", prompt: "test" });

    const jobs = getAllScheduledJobs();
    const jobId = jobs[0].id;
    expect(jobs[0].enabled).toBe(1);

    // Toggle off
    const res = await app.post(`/jobs/${jobId}/toggle`).set("Cookie", cookie);
    expect(res.status).toBe(303);
    expect(res.headers.location).toContain("disabled");

    // Verify
    const updated = getAllScheduledJobs();
    expect(updated[0].enabled).toBe(0);
  });

  it("POST /jobs/:id/delete deletes a job", async () => {
    const app = getTestApp();

    // Create a job
    await app
      .post("/jobs")
      .set("Cookie", cookie)
      .send({ name: "Delete Me", schedule: "0 9 * * *", prompt: "test" });

    const jobs = getAllScheduledJobs();
    expect(jobs).toHaveLength(1);

    // Delete
    const res = await app.post(`/jobs/${jobs[0].id}/delete`).set("Cookie", cookie);
    expect(res.status).toBe(303);
    expect(res.headers.location).toContain("Job+deleted");

    expect(getAllScheduledJobs()).toHaveLength(0);
  });

  it("POST /jobs/:id updates an existing job", async () => {
    const app = getTestApp();

    // Create
    await app
      .post("/jobs")
      .set("Cookie", cookie)
      .send({ name: "Original", schedule: "0 9 * * *", prompt: "old" });

    const jobId = getAllScheduledJobs()[0].id;

    // Update
    const res = await app
      .post(`/jobs/${jobId}`)
      .set("Cookie", cookie)
      .send({ name: "Updated", schedule: "0 12 * * *", prompt: "new" });
    expect(res.status).toBe(303);
    expect(res.headers.location).toContain("Job+updated");

    const updated = getAllScheduledJobs();
    expect(updated[0].name).toBe("Updated");
    expect(updated[0].schedule).toBe("0 12 * * *");
    expect(updated[0].prompt).toBe("new");
  });
});
